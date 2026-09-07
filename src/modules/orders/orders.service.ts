import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getLimaDayRange, getLimaDayjs } from '../../core/utils/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ReorderAssignmentsDto } from './dto/reorder-assignments.dto';
import { GroupStopsDto } from './dto/group-stops.dto';
import { UngroupStopDto } from './dto/ungroup-stop.dto';
import { GroupEvidenceDto } from './dto/group-evidence.dto';
import { RecipientCustomerType, GeocodingStatus, AssignmentStatus, RouteStatus, Prisma } from '@prisma/client';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { GeocodingService } from './services/geocoding.service';
import { OrdersClientResolverService } from './services/orders-client-resolver.service';
import { OrdersExcelParserService } from './services/orders-excel-parser.service';
import { OrdersImportService } from './services/orders-import.service';
import { OrderStopsGroupingService } from './services/order-stops-grouping.service';

const DEFAULT_ORDER_INCLUDE = {
  originBranch: true,
  customer: { include: { company: true } },
  assignments: {
    where: { voidedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    include: {
      driver: { include: { user: true } },
      events: true,
      evidences: true,
    },
  },
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingGateway: TrackingGateway,
    private readonly geocodingService: GeocodingService,
    private readonly clientResolverService: OrdersClientResolverService,
    private readonly excelParserService: OrdersExcelParserService,
    private readonly importService: OrdersImportService,
    private readonly orderStopsGroupingService: OrderStopsGroupingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async getValidOperatorId(creatorId?: string): Promise<string> {
    if (creatorId) {
      const userExists = await this.prisma.user.findUnique({ where: { id: creatorId } });
      if (userExists) return creatorId;
    }
    const defaultOperator = await this.prisma.user.findFirst();
    if (!defaultOperator) {
      throw new BadRequestException(
        'No existe ningún usuario en el sistema para asociar la operación de pedidos',
      );
    }
    return defaultOperator.id;
  }

  async create(dto: CreateOrderDto, creatorId?: string) {
    const finalCreatorId = await this.getValidOperatorId(creatorId);
    const finalCode = dto.code?.trim();
    if (!finalCode) {
      throw new BadRequestException('El Nº de pedido es obligatorio');
    }

    const exists = await this.prisma.order.findUnique({ where: { code: finalCode } });
    if (exists) {
      throw new BadRequestException(`El Nº de pedido "${finalCode}" ya se encuentra registrado`);
    }

    const cleanAddress = this.geocodingService.extractAddressFromUrl(dto.rawAddress);
    const geo = await this.geocodingService.resolveGeocodingFromUrl(cleanAddress, dto.latitude, dto.longitude);

    let finalFormatted = dto.formattedAddress;
    if (!finalFormatted || finalFormatted.startsWith('http')) {
      finalFormatted = cleanAddress && !cleanAddress.startsWith('http') ? cleanAddress : undefined;
    }

    const resolvedCustomerId = await this.clientResolverService.resolveOrCreateClient({
      recipientCustomerType: dto.recipientCustomerType === 'COMPANY' ? RecipientCustomerType.COMPANY : RecipientCustomerType.INDIVIDUAL,
      recipientDocument: dto.recipientDocument,
      recipientName: dto.recipientName,
      companyName: dto.companyName,
      companyRuc: dto.companyRuc,
      customerId: dto.customerId,
    });

    return this.prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          code: finalCode,
          waybill: dto.waybill,
          recipientCustomerType: dto.recipientCustomerType === 'COMPANY' ? RecipientCustomerType.COMPANY : RecipientCustomerType.INDIVIDUAL,
          recipientDocument: (dto.recipientDocument || '').trim(),
          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone,
          recipientEmail: dto.recipientEmail,
          rawAddress: dto.rawAddress,
          formattedAddress: finalFormatted,
          latitude: geo.lat,
          longitude: geo.lng,
          geocodingStatus: geo.status as GeocodingStatus,
          originBranchId: dto.originBranchId,
          customerId: resolvedCustomerId,
          warehouseContact: dto.warehouseContact || null,
        },
      });

      if (dto.driverId) {
        const targetDate = new Date();
        const { startOfDay, endOfDay } = getLimaDayRange(targetDate);

        const count = await tx.routeAssignment.count({
          where: {
            driverId: dto.driverId,
            date: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        });

        const assignment = await tx.routeAssignment.create({
          data: {
            orderId: createdOrder.id,
            driverId: dto.driverId,
            date: new Date(),
            sequenceIndex: count,
            status: AssignmentStatus.PENDING,
          },
        });

        await tx.orderEvent.create({
          data: {
            routeAssignmentId: assignment.id,
            type: 'REGISTERED',
            actor: finalCreatorId,
          },
        });

        this.trackingGateway.notifyOrderAssigned(dto.driverId, createdOrder.id);
      }

      return tx.order.findUnique({
        where: { id: createdOrder.id },
        include: DEFAULT_ORDER_INCLUDE,
      });
    });
  }

  async executeEodRouteCascadeClosure(): Promise<number> {
    const endOfDay = getLimaDayRange().endOfDay;

    // 1. Buscar todas las rutas activas (PENDING o IN_PROGRESS) cuya fecha sea igual o anterior a hoy
    const activeRoutes = await this.prisma.route.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        date: { lte: endOfDay },
      },
      include: {
        assignments: {
          where: {
            status: { in: ['PENDING', 'IN_TRANSIT'] },
            voidedAt: null,
          },
        },
      },
    });

    if (activeRoutes.length === 0) {
      // Si no hay rutas activas, verificar asignaciones huérfanas sin ruta
      return this.executeAutoClosure({
        date: { lte: endOfDay },
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] },
      });
    }

    let closedRouteCount = 0;

    for (const route of activeRoutes) {
      try {
        await this.prisma.$transaction(async (tx: any) => {
          // A. Cerrar la Ruta en cascada
          await tx.route.update({
            where: { id: route.id },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          });

          // B. Cerrar en cascada todas las asignaciones pendientes/en tránsito de esta ruta
          const pendingAssignments = route.assignments;
          for (const assignment of pendingAssignments) {
            await tx.routeAssignment.update({
              where: { id: assignment.id },
              data: {
                status: AssignmentStatus.OBSERVED,
                reasonText: 'Cierre automático nocturno a la medianoche',
              },
            });

            await tx.orderEvent.create({
              data: {
                routeAssignmentId: assignment.id,
                type: 'OBSERVED',
                actor: 'system',
                metadata: {
                  reasonText: 'Cierre automático nocturno a la medianoche',
                  note: 'Cierre en cascada de la ruta y entregas al finalizar la jornada operativa',
                },
              },
            });
          }
        });
        closedRouteCount++;
      } catch (err: any) {
        this.logger.error(`Failed to cascade auto-close route ${route.id}: ${err.message}`);
      }
    }

    return closedRouteCount;
  }

  async executeAutoClosure(whereClause: Prisma.RouteAssignmentWhereInput): Promise<number> {
    const activeAssignments = await this.prisma.routeAssignment.findMany({
      where: whereClause,
    });

    if (activeAssignments.length === 0) return 0;
    let successCount = 0;

    for (const assignment of activeAssignments) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.routeAssignment.update({
            where: { id: assignment.id },
            data: {
              status: AssignmentStatus.OBSERVED,
              reasonText: 'AUTO_CLOSED_EOD',
            },
          });

          await tx.orderEvent.create({
            data: {
              routeAssignmentId: assignment.id,
              type: 'OBSERVED',
              actor: 'system',
              metadata: {
                reasonText: 'AUTO_CLOSED_EOD',
                note: 'Cierre automático de fin de jornada operativa',
              },
            },
          });
        });
        successCount++;
      } catch (err: any) {
        this.logger.error(`Failed to auto-close assignment ${assignment.id}: ${err.message}`);
      }
    }
    return successCount;
  }

  async findAll(search?: string, page: number = 1, limit: number = 20, driverId?: string) {
    const skip = (page - 1) * limit;

    let whereCondition: Prisma.OrderWhereInput = {};

    if (search && search.trim() !== '') {
      const searchNormalized = search.trim();
      whereCondition = {
        OR: [
          { code: { contains: searchNormalized, mode: 'insensitive' } },
          { waybill: { contains: searchNormalized, mode: 'insensitive' } },
          { recipientName: { contains: searchNormalized, mode: 'insensitive' } },
          { recipientDocument: { contains: searchNormalized, mode: 'insensitive' } },
          { customer: { name: { contains: searchNormalized, mode: 'insensitive' } } },
        ],
      };
    }

    if (driverId) {
      whereCondition = {
        ...whereCondition,
        assignments: {
          some: {
            driverId,
            voidedAt: null,
          },
        },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where: whereCondition,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: DEFAULT_ORDER_INCLUDE,
      }),
      this.prisma.order.count({ where: whereCondition }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  async findToday(driverId?: string) {
    const targetDate = new Date();
    const { startOfDay, endOfDay } = getLimaDayRange(targetDate);

    let whereCondition: any;

    if (driverId) {
      whereCondition = {
        isPaused: false,
        assignments: {
          some: {
            driverId,
            voidedAt: null,
            OR: [
              { date: { gte: startOfDay, lte: endOfDay } },
              { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] } },
            ],
          },
        },
      };
    } else {
      whereCondition = {
        isPaused: false,
        OR: [
          { createdAt: { gte: startOfDay, lte: endOfDay } },
          {
            assignments: {
              none: { voidedAt: null },
            },
          },
          {
            assignments: {
              some: {
                date: { gte: startOfDay, lte: endOfDay },
                voidedAt: null,
              },
            },
          },
          // Reintentos: pedidos observados previamente que no tienen asignación activa para hoy o fecha futura
          {
            assignments: {
              some: {
                status: AssignmentStatus.OBSERVED,
                voidedAt: null,
              },
              none: {
                date: { gte: startOfDay },
                voidedAt: null,
              },
            },
          },
        ],
      };
    }

    const data = await this.prisma.order.findMany({
      where: whereCondition,
      include: DEFAULT_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data,
      meta: {
        total: data.length,
        page: 1,
        limit: data.length,
        totalPages: 1,
      },
    };
  }

  async getConfig() {
    const configs = await this.prisma.systemConfig.findMany();
    const configMap: Record<string, string> = {};
    for (const c of configs) {
      configMap[c.key] = c.value;
    }
    return configMap;
  }

  async updateConfig(config: Record<string, string>) {
    const updates = Object.entries(config).map(([key, value]) => {
      return this.prisma.systemConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    });
    await this.prisma.$transaction(updates);
    const updatedConfig = await this.getConfig();
    this.trackingGateway.notifyConfigUpdated(updatedConfig);
    return updatedConfig;
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        originBranch: true,
        customer: { include: { company: true } },
        assignments: {
          orderBy: [{ createdAt: 'asc' }],
          include: {
            driver: { include: { user: true } },
            events: {
              orderBy: { timestamp: 'asc' }
            },
            evidences: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }
    return order;
  }

  async importExcel(buffer: Buffer, operatorId?: string) {
    const finalOperatorId = await this.getValidOperatorId(operatorId);
    const validRows = await this.excelParserService.parseAndValidateExcelBuffer(buffer);
    return this.importService.executeAtomicImport(validRows, finalOperatorId);
  }

  private async buildOrderUpdateData(id: string, dto: UpdateOrderDto): Promise<any> {
    const { companyRuc, companyName, ...rest } = dto as any;
    const updateData: any = {};

    const validFields = [
      'waybill',
      'recipientCustomerType',
      'recipientDocument',
      'recipientName',
      'recipientPhone',
      'recipientEmail',
      'rawAddress',
      'formattedAddress',
      'latitude',
      'longitude',
      'originBranchId',
      'customerId',
      'warehouseContact',
    ];

    for (const key of validFields) {
      if (rest[key] !== undefined && rest[key] !== null) {
        updateData[key] = rest[key];
      }
    }

    if (dto.code !== undefined && dto.code !== null) {
      const cleanCode = dto.code.trim();
      if (!cleanCode) {
        throw new BadRequestException('El Nº de pedido es obligatorio');
      }
      const existingWithCode = await this.prisma.order.findFirst({
        where: { code: cleanCode, id: { not: id } },
      });
      if (existingWithCode) {
        throw new BadRequestException(`El Nº de pedido "${cleanCode}" ya se encuentra registrado`);
      }
      updateData.code = cleanCode;
    }

    if (dto.rawAddress !== undefined && dto.rawAddress !== null) {
      const cleanAddress = this.geocodingService.extractAddressFromUrl(dto.rawAddress);
      const geo = await this.geocodingService.resolveGeocodingFromUrl(cleanAddress, dto.latitude, dto.longitude);
      let finalFormatted = dto.formattedAddress;
      if (!finalFormatted || finalFormatted.startsWith('http')) {
        finalFormatted = cleanAddress && !cleanAddress.startsWith('http') ? cleanAddress : undefined;
      }
      updateData.rawAddress = dto.rawAddress;
      updateData.formattedAddress = finalFormatted;
      updateData.latitude = geo.lat;
      updateData.longitude = geo.lng;
      updateData.geocodingStatus = geo.status;
    }

    if (dto.recipientCustomerType === 'COMPANY') {
      const cleanRuc = (companyRuc || dto.recipientDocument || '').trim();
      const cleanName = (companyName || '').trim();

      if (cleanRuc) {
        const resolvedCustomerId = await this.clientResolverService.resolveOrCreateClient({
          recipientCustomerType: RecipientCustomerType.COMPANY,
          recipientDocument: cleanRuc,
          companyName: cleanName,
          companyRuc: cleanRuc,
        });

        updateData.customerId = resolvedCustomerId;
        updateData.recipientDocument = cleanRuc;
      }
    }

    return updateData;
  }

  private async syncOrderDriver(orderId: string, driverId?: string, removeDriver?: boolean) {
    if (driverId === undefined && !removeDriver) return;

    const targetDriverId = removeDriver ? null : (driverId ? driverId.trim() : null);
    const activeAssignment = await this.prisma.routeAssignment.findFirst({
      where: { orderId, status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] } },
      orderBy: { createdAt: 'desc' },
    });

    if (targetDriverId) {
      if (!activeAssignment) {
        const count = await this.prisma.routeAssignment.count({
          where: { driverId: targetDriverId, voidedAt: null },
        });
        await this.prisma.routeAssignment.create({
          data: {
            orderId,
            driverId: targetDriverId,
            date: new Date(),
            sequenceIndex: count,
            status: AssignmentStatus.PENDING,
          },
        });
        this.trackingGateway.notifyOrderAssigned(targetDriverId, orderId);
      } else if (activeAssignment.driverId !== targetDriverId) {
        const updateResult = await this.prisma.routeAssignment.updateMany({
          where: { id: activeAssignment.id, status: AssignmentStatus.PENDING },
          data: { driverId: targetDriverId },
        });
        if (updateResult.count === 0) {
          throw new BadRequestException('No se puede modificar el chofer. Es posible que el chofer ya haya iniciado la ruta de este pedido.');
        }
        this.trackingGateway.notifyOrderAssigned(targetDriverId, orderId);
      }
    } else if (activeAssignment) {
      const updateResult = await this.prisma.routeAssignment.updateMany({
        where: { id: activeAssignment.id, status: AssignmentStatus.PENDING },
        data: { voidedAt: new Date() }
      });
      const deleteResult = { count: updateResult.count }; // Para mantener compatibilidad con la siguiente línea
      
      if (updateResult.count > 0) {
        await this.prisma.orderEvent.create({
          data: {
            routeAssignmentId: activeAssignment.id,
            type: 'DRIVER_UNASSIGNED',
            actor: 'system',
            metadata: { note: 'Chofer removido (Sin Asignar)' }
          }
        });

        if (activeAssignment.routeId) {
          await this.cleanEmptyRouteIfNeeded(activeAssignment.routeId);
        }
      }
      if (deleteResult.count === 0) {
        throw new BadRequestException('No se puede remover el chofer porque es posible que ya haya iniciado la ruta de este pedido.');
      }
    }
  }

  async update(id: string, dto: UpdateOrderDto) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      include: {
        assignments: {
          where: { voidedAt: null },
        },
      },
    });
    if (!existing) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (existing.assignments && existing.assignments.length > 0 && !dto.removeDriver) {
      throw new BadRequestException(
        'No se puede editar este pedido porque ya se encuentra asignado a una ruta o chofer.',
      );
    }

    const updateData = await this.buildOrderUpdateData(id, dto);
    await this.syncOrderDriver(id, dto.driverId, dto.removeDriver);

    if (Object.keys(updateData).length > 0) {
      await this.prisma.order.update({
        where: { id },
        data: updateData,
      });
    }

    return this.findOne(id);
  }

  /**
   * Valida que el conductor no tenga ninguna ruta anterior abierta (PENDING o IN_PROGRESS)
   * con entregas activas sin finalizar.
   *
   * Regla de separación estricta:
   * (a) Cualquier fecha estrictamente anterior al inicio del día objetivo (date < targetDayStart)
   *     bloquea sin importar el sequenceIndex.
   * (b) Solo dentro del mismo día calendario (targetDayStart <= date <= targetDayEnd),
   *     se compara por sequenceIndex estrictamente menor.
   */
  async assertNoUnclosedPriorRoutes(
    driverId: string,
    targetDate: Date | string,
    currentSequenceIndex?: number,
    excludeRouteId?: string,
  ): Promise<void> {
    const { startOfDay: targetDayStart, endOfDay: targetDayEnd } = getLimaDayRange(targetDate);

    const priorOpenRoute = await this.prisma.route.findFirst({
      where: {
        driverId,
        ...(excludeRouteId ? { id: { not: excludeRouteId } } : {}),
        status: { in: [RouteStatus.PENDING, RouteStatus.IN_PROGRESS] },
        assignments: {
          some: {
            voidedAt: null,
            status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] },
          },
        },
        OR: [
          // (a) Fecha estrictamente anterior en Lima (bloquea sin importar sequenceIndex)
          {
            date: { lt: targetDayStart },
          },
          // (b) Misma fecha, pero sequenceIndex estrictamente menor
          ...(currentSequenceIndex !== undefined
            ? [
                {
                  date: { gte: targetDayStart, lte: targetDayEnd },
                  sequenceIndex: { lt: currentSequenceIndex },
                },
              ]
            : []),
        ],
      },
    });

    if (priorOpenRoute) {
      throw new BadRequestException(
        'No puedes iniciar este recorrido porque tienes una ruta anterior abierta sin finalizar.',
      );
    }
  }

  async updateStatus(routeAssignmentId: string, dto: UpdateOrderStatusDto) {
    const existing = await this.prisma.routeAssignment.findUnique({
      where: { id: routeAssignmentId },
    });
    if (!existing) {
      throw new NotFoundException('Asignación de ruta no encontrada');
    }

    if (existing.status === AssignmentStatus.DELIVERED || existing.status === AssignmentStatus.OBSERVED) {
      throw new BadRequestException('No se puede modificar una asignación que ya ha sido finalizada');
    }

    if (dto.status === AssignmentStatus.IN_TRANSIT) {
      const { startOfDay: todayStart, endOfDay: todayEnd } = getLimaDayRange();
      const assignmentDate = getLimaDayjs(existing.date);

      if (assignmentDate.isBefore(todayStart) || assignmentDate.isAfter(todayEnd)) {
        throw new BadRequestException('Solo puedes iniciar recorridos programados para el día de hoy.');
      }

      // Validar que el chofer no tenga rutas anteriores abiertas sin finalizar
      if (existing.routeId) {
        const currentRoute = await this.prisma.route.findUnique({
          where: { id: existing.routeId },
          select: { id: true, sequenceIndex: true, date: true },
        });

        await this.assertNoUnclosedPriorRoutes(
          existing.driverId,
          existing.date,
          currentRoute?.sequenceIndex,
          currentRoute?.id,
        );
      } else {
        await this.assertNoUnclosedPriorRoutes(
          existing.driverId,
          existing.date,
        );
      }

      const activeAssignment = await this.prisma.routeAssignment.findFirst({
        where: {
          driverId: existing.driverId,
          status: AssignmentStatus.IN_TRANSIT,
        },
      });

      if (activeAssignment && activeAssignment.id !== routeAssignmentId) {
        const isSameStopGroup =
          existing.stopGroupId &&
          activeAssignment.stopGroupId &&
          existing.stopGroupId === activeAssignment.stopGroupId;

        if (!isSameStopGroup) {
          throw new BadRequestException('El chofer ya tiene un recorrido en tránsito activo');
        }
      }
    }

    const updateData: any = { status: dto.status };
    if (dto.reasonText !== undefined) {
      updateData.reasonText = dto.reasonText;
    }

    if (dto.status === AssignmentStatus.IN_TRANSIT && dto.latitude && dto.longitude) {
      updateData.originLatitude = dto.latitude;
      updateData.originLongitude = dto.longitude;

      try {
        const addressText = await this.geocodingService.reverseGeocodeCoords(dto.latitude, dto.longitude);
        updateData.originAddress = addressText || null;
      } catch (e) {
        updateData.originAddress = null;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.routeAssignment.update({
        where: { id: routeAssignmentId },
        data: updateData,
      });

      await tx.orderEvent.create({
        data: {
          routeAssignmentId,
          type: dto.status === AssignmentStatus.IN_TRANSIT ? 'TRANSIT_STARTED' : dto.status,
          actor: dto.userId || 'system',
          metadata: dto.reasonText ? { reasonText: dto.reasonText } : Prisma.JsonNull,
        },
      });

      // Si la parada está consolidada (stopGroupId) y pasa a IN_TRANSIT, poner a los hermanos pendientes en IN_TRANSIT automáticamente
      const siblingUpdatedList: any[] = [];
      if (existing.stopGroupId && dto.status === AssignmentStatus.IN_TRANSIT) {
        const pendingSiblings = await tx.routeAssignment.findMany({
          where: {
            stopGroupId: existing.stopGroupId,
            id: { not: routeAssignmentId },
            status: AssignmentStatus.PENDING,
          },
        });

        for (const sibling of pendingSiblings) {
          const sibUpdated = await tx.routeAssignment.update({
            where: { id: sibling.id },
            data: updateData,
          });

          await tx.orderEvent.create({
            data: {
              routeAssignmentId: sibling.id,
              type: 'TRANSIT_STARTED',
              actor: dto.userId || 'system',
              metadata: dto.reasonText ? { reasonText: dto.reasonText } : Prisma.JsonNull,
            },
          });

          siblingUpdatedList.push(sibUpdated);
        }
      }

      if (existing.routeId) {
        if (dto.status === AssignmentStatus.IN_TRANSIT) {
          await tx.route.update({
            where: { id: existing.routeId },
            data: {
              status: 'IN_PROGRESS',
              startedAt: new Date(),
            },
          });
        } else if (dto.status === AssignmentStatus.DELIVERED || dto.status === AssignmentStatus.OBSERVED) {
          const remainingActive = await tx.routeAssignment.count({
            where: {
              routeId: existing.routeId,
              id: { not: routeAssignmentId },
              status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] },
              voidedAt: null,
            },
          });

          if (remainingActive === 0) {
            await tx.route.update({
              where: { id: existing.routeId },
              data: {
                status: 'COMPLETED',
                completedAt: new Date(),
              },
            });
          } else {
            await tx.route.update({
              where: { id: existing.routeId },
              data: {
                status: 'IN_PROGRESS',
              },
            });
          }
        }
      }

      return { assignment, siblingUpdatedList };
    });

    if (dto.status === AssignmentStatus.IN_TRANSIT) {
      this.eventEmitter.emit('order.transit_started', {
        assignment: updated.assignment,
        siblings: updated.siblingUpdatedList,
      });
    } else if (dto.status === AssignmentStatus.DELIVERED || dto.status === AssignmentStatus.OBSERVED) {
      this.eventEmitter.emit('order.completed', updated.assignment);
    }

    return updated.assignment;
  }

  async addEvidence(routeAssignmentId: string, s3Url: string, signatureText?: string) {
    const existing = await this.prisma.routeAssignment.findUnique({ where: { id: routeAssignmentId } });
    if (!existing) {
      throw new NotFoundException('Asignación de ruta no encontrada');
    }

    return this.prisma.evidence.create({
      data: {
        routeAssignmentId,
        s3Url,
        signatureText: signatureText || null,
      },
    });
  }

  async addGroupEvidence(dto: GroupEvidenceDto) {
    return this.orderStopsGroupingService.addGroupEvidence(dto);
  }

  async getDuplicateStopSuggestions(dateStr?: string) {
    return this.orderStopsGroupingService.getDuplicateStopSuggestions(dateStr);
  }

  async groupStops(dto: GroupStopsDto, userId?: string) {
    return this.orderStopsGroupingService.groupStops(dto, userId);
  }

  async ungroupStop(dto: UngroupStopDto, userId?: string) {
    return this.orderStopsGroupingService.ungroupStop(dto, userId);
  }

  async reorderAssignments(userId: string, dto: ReorderAssignmentsDto) {
    const driverProfile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!driverProfile) {
      throw new ForbiddenException('El usuario no posee un perfil de conductor');
    }

    const assignments = await this.prisma.routeAssignment.findMany({
      where: {
        id: { in: dto.routeAssignmentIds },
        driverId: driverProfile.id,
      },
    });

    const hasInvalid = assignments.some(
      (a) => a.status === AssignmentStatus.DELIVERED || a.status === AssignmentStatus.OBSERVED,
    );

    if (hasInvalid || assignments.length !== dto.routeAssignmentIds.length) {
      throw new BadRequestException(
        'Solo se pueden reordenar asignaciones pendientes o en tránsito pertenecientes al chofer',
      );
    }

    let currentSeq = 0;
    const groupSeqMap = new Map<string, number>();

    const updates = [];
    for (const id of dto.routeAssignmentIds) {
      const assignment = assignments.find((a) => a.id === id);
      if (!assignment) continue;

      let seq: number;
      if (assignment.stopGroupId) {
        if (groupSeqMap.has(assignment.stopGroupId)) {
          seq = groupSeqMap.get(assignment.stopGroupId)!;
        } else {
          seq = currentSeq++;
          groupSeqMap.set(assignment.stopGroupId, seq);
        }
      } else {
        seq = currentSeq++;
      }

      updates.push(
        this.prisma.routeAssignment.update({
          where: { id },
          data: { sequenceIndex: seq },
        }),
      );
    }

    const result = await this.prisma.$transaction(updates);
    this.trackingGateway.notifyStopsUpdated(driverProfile.id);
    return result;
  }

  async reassignAssignment(
    previousAssignmentId: string,
    dto: { driverId: string; vehicleId?: string; date: string },
    userId: string,
  ) {
    const prev = await this.prisma.routeAssignment.findUnique({
      where: { id: previousAssignmentId },
    });
    if (!prev) {
      throw new NotFoundException('Asignación previa no encontrada');
    }

    if (prev.status !== 'OBSERVED') {
      throw new BadRequestException('Solo se pueden reasignar asignaciones en estado OBSERVED');
    }

    // Usamos dayjs.tz para que startOfDay coincida exactamente con la medianoche de Lima (05:00 UTC)
    const dateStr = dto.date.split('T')[0];
    const { startOfDay, endOfDay } = getLimaDayRange(dateStr);

    const maxSeq = await this.prisma.routeAssignment.aggregate({
      where: {
        driverId: dto.driverId,
        date: { gte: startOfDay, lte: endOfDay },
        voidedAt: null,
      },
      _max: { sequenceIndex: true },
    });

    const nextIndex = (maxSeq._max?.sequenceIndex ?? -1) + 1;

    return this.prisma.$transaction(async (tx) => {
      const newAssignment = await tx.routeAssignment.create({
        data: {
          orderId: prev.orderId,
          driverId: dto.driverId,
          vehicleId: dto.vehicleId || null, // Categoría B: vehicleId es opcional; undefined se normaliza a null para Prisma
          date: startOfDay,
          sequenceIndex: nextIndex,
          status: 'PENDING',
          previousAssignmentId: prev.id,
        },
      });

      await tx.orderEvent.create({
        data: {
          routeAssignmentId: newAssignment.id,
          type: 'REGISTERED',
          actor: userId || 'system',
          metadata: {
            reason: 'REASSIGNED_FROM_OBSERVED',
            previousAssignmentId: prev.id,
          },
        },
      });

      await tx.orderEvent.create({
        data: {
          routeAssignmentId: newAssignment.id,
          type: 'REASSIGNED',
          actor: userId || 'system',
          metadata: {
            fromDate: prev.date,
            toDate: startOfDay,
            fromDriverId: prev.driverId,
            toDriverId: dto.driverId,
            previousAssignmentId: prev.id,
          },
        },
      });




      this.trackingGateway.notifyOrderAssigned(dto.driverId, newAssignment.orderId);

      return newAssignment;
    });
  }

  async remove(id: string) {
    // Atomic delete: Only delete if the order has NO assignments (no driver ever assigned, inherently PENDING)
    // This prevents race conditions where a driver is assigned exactly while deleting.
    const result = await this.prisma.order.deleteMany({
      where: {
        id,
        assignments: {
          none: {},
        },
      },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        'No se puede eliminar este pedido porque ya tiene un chofer asignado o no se encuentra en estado Pendiente.',
      );
    }

    return { success: true };
  }

  async getPublicTracking(token: string) {
    const cleanToken = token?.trim();
    if (!cleanToken) {
      throw new NotFoundException('Token de seguimiento inválido');
    }

    const order = await this.prisma.order.findUnique({
      where: {
        publicTrackingToken: cleanToken,
      },
      include: {
        originBranch: true,
        customer: { include: { company: true } },
        assignments: {
          where: { voidedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            driver: {
              include: {
                user: {
                  select: { name: true },
                },
              },
            },
            vehicle: true,
            events: {
              orderBy: { timestamp: 'asc' },
              select: {
                id: true,
                type: true,
                actor: true,
                timestamp: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('No se encontró información para el código de seguimiento proporcionado');
    }

    const activeAssignment = order.assignments[0] || null;
    const status = activeAssignment?.status || 'PENDING';

    let driverInfo = null;
    let driverLocation = null;

    if (activeAssignment?.driver) {
      driverInfo = {
        name: activeAssignment.driver.user?.name || 'Chofer Asignado',
        unit: activeAssignment.driver.unit || activeAssignment.vehicle?.plate || null,
      };

      // Si el pedido está en camino, exponer ubicación actual en tiempo real desde snapshots
      if (status === 'IN_TRANSIT') {
        const latestSnapshot = await this.prisma.locationSnapshot.findFirst({
          where: { driverId: activeAssignment.driverId },
          orderBy: { createdAt: 'desc' },
        });

        if (latestSnapshot) {
          driverLocation = {
            latitude: latestSnapshot.latitude,
            longitude: latestSnapshot.longitude,
            updatedAt: latestSnapshot.createdAt,
          };
        }
      }
    }

    let groupedOrders: Array<{ code: string; waybill: string | null }> = [];

    if (activeAssignment?.stopGroupId && order.customerId) {
      const siblingAssignments = await this.prisma.routeAssignment.findMany({
        where: {
          stopGroupId: activeAssignment.stopGroupId,
          id: { not: activeAssignment.id },
          voidedAt: null,
          order: {
            customerId: order.customerId, // PRIVACIDAD ESTRICTA: SOLO DEL MISMO CLIENTE
          },
        },
        include: {
          order: {
            select: { code: true, waybill: true },
          },
        },
      });

      groupedOrders = siblingAssignments.map((sa) => ({
        code: sa.order.code,
        waybill: sa.order.waybill,
      }));
    }

    return {
      orderId: order.id,
      code: order.code,
      publicTrackingToken: order.publicTrackingToken,
      waybill: order.waybill,
      status: status,
      recipientName: order.recipientName,
      address: order.formattedAddress || order.rawAddress,
      destinationLatitude: order.latitude ? Number(order.latitude) : null,
      destinationLongitude: order.longitude ? Number(order.longitude) : null,
      originAddress: activeAssignment?.originAddress || order.originBranch?.address || null,
      originLatitude: activeAssignment?.originLatitude || order.originBranch?.latitude || null,
      originLongitude: activeAssignment?.originLongitude || order.originBranch?.longitude || null,
      driver: driverInfo,
      driverLocation: driverLocation,
      events: activeAssignment?.events || [],
      groupedOrders,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  async cleanEmptyRouteIfNeeded(routeId: string, tx?: any) {
    const client = tx || this.prisma;
    const remainingActive = await client.routeAssignment.count({
      where: { routeId, voidedAt: null },
    });

    if (remainingActive === 0) {
      const route = await client.route.findUnique({
        where: { id: routeId },
        select: { status: true },
      });

      if (route?.status === RouteStatus.PENDING) {
        await client.route.update({
          where: { id: routeId },
          data: { status: RouteStatus.CANCELLED },
        });
      } else if (route?.status === RouteStatus.IN_PROGRESS) {
        await client.route.update({
          where: { id: routeId },
          data: { status: RouteStatus.COMPLETED, completedAt: new Date() },
        });
      }
    }
  }

}
