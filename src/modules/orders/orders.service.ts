import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Lima';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ReorderAssignmentsDto } from './dto/reorder-assignments.dto';
import { RecipientCustomerType, GeocodingStatus, AssignmentStatus, Prisma } from '@prisma/client';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { GeocodingService } from './services/geocoding.service';
import { OrdersClientResolverService } from './services/orders-client-resolver.service';
import { OrdersExcelParserService } from './services/orders-excel-parser.service';
import { OrdersImportService } from './services/orders-import.service';

const DEFAULT_ORDER_INCLUDE = {
  originBranch: true,
  customer: { include: { company: true } },
  assignments: {
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
        const startOfDay = dayjs(targetDate).tz(TIMEZONE).startOf('day').toDate();
        const endOfDay = dayjs(targetDate).tz(TIMEZONE).endOf('day').toDate();

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
    const endOfDay = dayjs().tz(TIMEZONE).endOf('day').toDate();

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
    // 1. Cierre en cascada a la medianoche: Cerrar Rutas activas del día y sus pedidos asociados
    await this.executeEodRouteCascadeClosure();

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
    const whereCondition: any = {};

    if (driverId) {
      whereCondition.assignments = {
        some: { 
          driverId,
          voidedAt: null
        },
      };
    }

    if (search && search.trim() !== '') {
      const searchFilter = { contains: search, mode: 'insensitive' as const };
      whereCondition.OR = [
        { code: searchFilter },
        { waybill: searchFilter },
        { recipientName: searchFilter },
        { customer: { name: searchFilter } },
      ];
    }

    const total = await this.prisma.order.count({ where: whereCondition });
    const data = await this.prisma.order.findMany({
      where: whereCondition,
      include: DEFAULT_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findToday(driverId?: string) {
    const targetDate = new Date();
    const startOfDay = dayjs(targetDate).tz(TIMEZONE).startOf('day').toDate();
    const endOfDay = dayjs(targetDate).tz(TIMEZONE).endOf('day').toDate();

    // Auto-cierre de asignaciones colgadas de días anteriores para el chofer (si se especifica) o global
    await this.executeAutoClosure({
      ...(driverId ? { driverId } : {}),
      date: { lt: startOfDay },
      status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] },
    });

    let whereCondition: any;

    if (driverId) {
      whereCondition = {
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
      }
      if (deleteResult.count === 0) {
        throw new BadRequestException('No se puede remover el chofer porque es posible que ya haya iniciado la ruta de este pedido.');
      }
    }
  }

  async update(id: string, dto: UpdateOrderDto) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Pedido no encontrado');
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

  async updateStatus(routeAssignmentId: string, dto: UpdateOrderStatusDto) {
    const existing = await this.prisma.routeAssignment.findUnique({
      where: { id: routeAssignmentId },
    });
    if (!existing) {
      throw new NotFoundException('Asignación de ruta no encontrada');
    }

    if (dto.status === AssignmentStatus.IN_TRANSIT) {
      const activeAssignment = await this.prisma.routeAssignment.findFirst({
        where: {
          driverId: existing.driverId,
          status: AssignmentStatus.IN_TRANSIT,
        },
      });

      if (activeAssignment && activeAssignment.id !== routeAssignmentId) {
        throw new BadRequestException('El chofer ya tiene un recorrido en tránsito activo');
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

      return assignment;
    });

    if (dto.status === AssignmentStatus.IN_TRANSIT) {
      this.eventEmitter.emit('order.transit_started', updated);
    } else if (dto.status === AssignmentStatus.DELIVERED || dto.status === AssignmentStatus.OBSERVED) {
      this.eventEmitter.emit('order.completed', updated);
    }

    return updated;
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

    return this.prisma.$transaction(
      dto.routeAssignmentIds.map((id, index) =>
        this.prisma.routeAssignment.update({
          where: { id },
          data: { sequenceIndex: index },
        }),
      ),
    );
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
    const startOfDay = dayjs.tz(dateStr, TIMEZONE).startOf('day').toDate();
    const endOfDay = dayjs.tz(dateStr, TIMEZONE).endOf('day').toDate();

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
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
