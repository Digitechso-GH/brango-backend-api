import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { AssignmentStatus, Prisma } from '@prisma/client';
import { getLimaDayRange } from '../../../core/utils/date.util';
import { DEFAULT_ORDER_INCLUDE } from '../orders.constants';

@Injectable()
export class OrdersQueryService {
  private readonly logger = new Logger(OrdersQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingGateway: TrackingGateway,
  ) {}

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

  async findToday(driverIdOrUserId?: string) {
    const targetDate = new Date();
    const { startOfDay, endOfDay } = getLimaDayRange(targetDate);

    let resolvedDriverId = driverIdOrUserId;
    if (driverIdOrUserId) {
      const profile = await this.prisma.driverProfile.findFirst({
        where: {
          OR: [
            { id: driverIdOrUserId },
            { userId: driverIdOrUserId },
          ],
        },
        select: { id: true },
      });
      if (profile) {
        resolvedDriverId = profile.id;
      }
    }

    let whereCondition: any;

    if (resolvedDriverId) {
      whereCondition = {
        isPaused: false,
        assignments: {
          some: {
            driverId: resolvedDriverId,
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
            vehicle: true,
            events: { orderBy: { timestamp: 'asc' } },
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
    const status = activeAssignment?.status || AssignmentStatus.PENDING;

    let driverInfo = null;
    let driverLocation = null;

    if (activeAssignment?.driver) {
      driverInfo = {
        name: activeAssignment.driver.user?.name || 'Chofer Asignado',
        unit: activeAssignment.driver.unit || activeAssignment.vehicle?.plate || null,
      };

      // Si el pedido está en camino, exponer ubicación actual en tiempo real desde snapshots
      if (status === AssignmentStatus.IN_TRANSIT) {
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
      order: {
        id: order.id,
        code: order.code,
        recipientName: order.recipientName,
        rawAddress: order.rawAddress,
        formattedAddress: order.formattedAddress,
        latitude: order.latitude,
        longitude: order.longitude,
        status,
        createdAt: order.createdAt,
      },
      originBranch: order.originBranch
        ? {
            id: order.originBranch.id,
            name: order.originBranch.name,
            address: order.originBranch.address,
            latitude: order.originBranch.latitude,
            longitude: order.originBranch.longitude,
          }
        : null,
      driver: driverInfo,
      driverLocation,
      events: activeAssignment?.events || [],
    };
  }
}
