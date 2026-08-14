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
    orderBy: [{ date: 'desc' as const }, { createdAt: 'desc' as const }],
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
        const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

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

  async findAll(driverId?: string, todayOnly?: boolean | string, dateStr?: string) {
    const whereCondition: any = {};

    if (todayOnly === true || todayOnly === 'true' || dateStr) {
      const targetDate = dateStr ? new Date(dateStr) : new Date();
      const startOfDay = dayjs(targetDate).tz(TIMEZONE).startOf('day').toDate();
      const endOfDay = dayjs(targetDate).tz(TIMEZONE).endOf('day').toDate();

      if (driverId) {
        // 2da Capa de Protección: Auto-cierre de asignaciones colgadas de días anteriores
        await this.executeAutoClosure({
          driverId,
          date: { lt: startOfDay },
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] },
        });

        whereCondition.assignments = {
          some: { driverId },
        };
        whereCondition.OR = [
          { createdAt: { gte: startOfDay, lte: endOfDay } },
          { assignments: { some: { driverId, status: { in: ['PENDING', 'IN_TRANSIT'] } } } },
        ];
      } else {
        whereCondition.createdAt = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }
    } else if (driverId) {
      whereCondition.assignments = {
        some: { driverId },
      };
    }

    return this.prisma.order.findMany({
      where: whereCondition,
      include: DEFAULT_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: DEFAULT_ORDER_INCLUDE,
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

  private async syncOrderDriver(orderId: string, driverId?: string) {
    if (driverId === undefined) return;

    const targetDriverId = driverId?.trim();
    const activeAssignment = await this.prisma.routeAssignment.findFirst({
      where: { orderId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    if (targetDriverId) {
      if (!activeAssignment) {
        const count = await this.prisma.routeAssignment.count({
          where: { driverId: targetDriverId },
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
        await this.prisma.routeAssignment.update({
          where: { id: activeAssignment.id },
          data: { driverId: targetDriverId },
        });
        this.trackingGateway.notifyOrderAssigned(targetDriverId, orderId);
      }
    } else if (activeAssignment) {
      await this.prisma.routeAssignment.delete({
        where: { id: activeAssignment.id },
      });
    }
  }

  async update(id: string, dto: UpdateOrderDto) {
    const existing = await this.prisma.order.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const updateData = await this.buildOrderUpdateData(id, dto);
    await this.syncOrderDriver(id, dto.driverId);

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

    const targetDate = new Date(dto.date);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const maxSeq = await this.prisma.routeAssignment.aggregate({
      where: {
        driverId: dto.driverId,
        date: { gte: startOfDay, lte: endOfDay },
      },
      _max: { sequenceIndex: true },
    });

    const nextIndex = (maxSeq._max.sequenceIndex ?? -1) + 1;

    return this.prisma.$transaction(async (tx) => {
      const newAssignment = await tx.routeAssignment.create({
        data: {
          orderId: prev.orderId,
          driverId: dto.driverId,
          vehicleId: dto.vehicleId || null,
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
}
