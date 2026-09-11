import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { GeocodingService } from './geocoding.service';
import { OrdersClientResolverService } from './orders-client-resolver.service';
import { OrdersExcelParserService } from './orders-excel-parser.service';
import { OrdersImportService } from './orders-import.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import { UpdateOrderDto } from '../dto/update-order.dto';
import {
  RecipientCustomerType,
  AssignmentStatus,
  RouteStatus,
  GeocodingStatus,
  Prisma,
} from '@prisma/client';
import { getLimaDayRange, getLimaDayjs } from '../../../core/utils/date.util';
import { ORDER_EVENT_TYPES } from '../constants/order-events.constants';
import { DEFAULT_ORDER_INCLUDE } from '../orders.constants';

@Injectable()
export class OrdersLifecycleService {
  private readonly logger = new Logger(OrdersLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingGateway: TrackingGateway,
    private readonly geocodingService: GeocodingService,
    private readonly clientResolverService: OrdersClientResolverService,
    private readonly excelParserService: OrdersExcelParserService,
    private readonly importService: OrdersImportService,
  ) {}

  async getValidOperatorId(creatorId?: string): Promise<string> {
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
          recipientDocument: dto.recipientDocument,
          recipientName: dto.recipientName,
          recipientPhone: dto.recipientPhone,
          recipientEmail: dto.recipientEmail,
          warehouseContact: dto.warehouseContact,
          rawAddress: dto.rawAddress,
          formattedAddress: finalFormatted,
          latitude: geo.lat,
          longitude: geo.lng,
          geocodingStatus: geo.status as GeocodingStatus,
          originBranchId: dto.originBranchId,
          customerId: resolvedCustomerId,
          dueDate: dto.dueDate ? getLimaDayjs(dto.dueDate).endOf('day').toDate() : null,
        },
      });

      if (dto.driverId) {
        const count = await tx.routeAssignment.count({
          where: { driverId: dto.driverId, voidedAt: null },
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
            type: ORDER_EVENT_TYPES.REGISTERED,
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

  async importExcel(buffer: Buffer, operatorId?: string) {
    const finalOperatorId = await this.getValidOperatorId(operatorId);
    const validRows = await this.excelParserService.parseAndValidateExcelBuffer(buffer);
    return this.importService.executeAtomicImport(validRows, finalOperatorId);
  }

  async executeEodRouteCascadeClosure(): Promise<number> {
    const endOfDay = getLimaDayRange().endOfDay;

    const activeRoutes = await this.prisma.route.findMany({
      where: {
        status: { in: [RouteStatus.PENDING, RouteStatus.IN_PROGRESS] },
        date: { lte: endOfDay },
      },
      include: {
        assignments: {
          where: {
            status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] },
            voidedAt: null,
          },
        },
      },
    });

    if (activeRoutes.length === 0) {
      return this.executeAutoClosure({
        date: { lte: endOfDay },
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] },
      });
    }

    let closedRouteCount = 0;

    for (const route of activeRoutes) {
      try {
        await this.prisma.$transaction(async (tx: any) => {
          await tx.route.update({
            where: { id: route.id },
            data: {
              status: RouteStatus.COMPLETED,
              completedAt: new Date(),
            },
          });

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
                type: ORDER_EVENT_TYPES.OBSERVED,
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
              type: ORDER_EVENT_TYPES.OBSERVED,
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

  async buildOrderUpdateData(id: string, dto: UpdateOrderDto): Promise<any> {
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

    if (dto.dueDate !== undefined) {
      updateData.dueDate = dto.dueDate && String(dto.dueDate).trim() !== ''
        ? getLimaDayjs(dto.dueDate).endOf('day').toDate()
        : null;
    }
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
      updateData.geocodingStatus = geo.status as GeocodingStatus;
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

  async syncOrderDriver(orderId: string, driverId?: string, removeDriver?: boolean) {
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
        data: { voidedAt: new Date() },
      });

      if (updateResult.count > 0) {
        await this.prisma.orderEvent.create({
          data: {
            routeAssignmentId: activeAssignment.id,
            type: ORDER_EVENT_TYPES.DRIVER_UNASSIGNED,
            actor: 'system',
            metadata: { note: 'Chofer removido (Sin Asignar)' },
          },
        });

        if (activeAssignment.routeId) {
          await this.cleanEmptyRouteIfNeeded(activeAssignment.routeId);
        }
      }
      if (updateResult.count === 0) {
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

    return this.prisma.order.findUnique({
      where: { id },
      include: {
        originBranch: true,
        customer: { include: { company: true } },
        assignments: {
          orderBy: [{ createdAt: 'asc' }],
          include: {
            driver: { include: { user: true } },
            vehicle: true,
            events: { orderBy: { timestamp: 'asc' } },
            evidences: true,
          },
        },
      },
    });
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

    if (prev.status !== AssignmentStatus.OBSERVED) {
      throw new BadRequestException('Solo se pueden reasignar asignaciones en estado OBSERVED');
    }

    const { startOfDay, endOfDay } = getLimaDayRange(dto.date);

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
          vehicleId: dto.vehicleId || null,
          date: startOfDay,
          sequenceIndex: nextIndex,
          status: AssignmentStatus.PENDING,
          previousAssignmentId: prev.id,
        },
      });

      await tx.orderEvent.create({
        data: {
          routeAssignmentId: newAssignment.id,
          type: ORDER_EVENT_TYPES.REGISTERED,
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
          type: ORDER_EVENT_TYPES.REASSIGNED,
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
}
