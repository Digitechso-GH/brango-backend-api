import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRouteDto, GetRoutesQueryDto } from './routes.dto';
import { RouteStatus, AssignmentStatus } from '@prisma/client';
import { getLimaDayRange } from '../../core/utils/date.util';
import { TrackingGateway } from '../tracking/tracking.gateway';

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingGateway: TrackingGateway,
  ) {}

  async createRoute(dto: CreateRouteDto) {
    const { startOfDay: targetDate, endOfDay } = getLimaDayRange(dto.date);
    const assignments = dto.assignments || [];

    return this.prisma.$transaction(async (tx: any) => {
      // 1. Validar que el chofer no tenga ya una ruta activa (PENDING o IN_PROGRESS) en la misma fecha
      const activeRouteSameDay = await tx.route.findFirst({
        where: { 
          driverId: dto.driverId, 
          date: { gte: targetDate, lte: endOfDay },
          status: { in: [RouteStatus.PENDING, RouteStatus.IN_PROGRESS] }
        },
      });
      if (activeRouteSameDay) {
        throw new BadRequestException('El chofer ya tiene una ruta activa para este día. Debes esperar a que la finalice.');
      }

      // 2. Validar pedidos si se proporcionan asignaciones
      if (assignments.length > 0) {
        const orderIds = assignments.map((a) => a.orderId);

        // Bloquear pedidos en pausa comercial
        const pausedOrder = await tx.order.findFirst({
          where: {
            id: { in: orderIds },
            isPaused: true,
          },
        });
        if (pausedOrder) {
          throw new BadRequestException(
            `El pedido con código ${pausedOrder.code} está en pausa y no puede asignarse a una ruta.`,
          );
        }

        // Validar que no tengan asignaciones activas (entregadas, en tránsito o para la misma fecha)
        const existingAssignments = await tx.routeAssignment.findFirst({
          where: {
            orderId: { in: orderIds },
            voidedAt: null,
            OR: [
              { status: AssignmentStatus.DELIVERED },
              { status: AssignmentStatus.IN_TRANSIT },
              { date: { gte: targetDate, lte: endOfDay } },
            ],
          },
        });

        if (existingAssignments) {
          throw new BadRequestException(
            `El pedido con ID ${existingAssignments.orderId} ya tiene una asignación activa o ya fue entregado.`,
          );
        }
      }

      // 3. Calcular sequenceIndex de la Route
      const routeCount = await tx.route.count({
        where: {
          driverId: dto.driverId,
          date: { gte: targetDate, lte: endOfDay },
        },
      });
      const routeSequenceIndex = routeCount + 1;

      // 4. Crear la Route atómicamente con sus asignaciones (permite 0 asignaciones)
      const newRoute = await tx.route.create({
        data: {
          name: dto.name || null,
          driverId: dto.driverId,
          date: targetDate,
          sequenceIndex: routeSequenceIndex,
          status: 'PENDING',
          overviewPolyline: dto.overviewPolyline,
          assignments: assignments.length > 0
            ? {
                create: assignments.map((assignment, index) => ({
                  orderId: assignment.orderId,
                  driverId: dto.driverId,
                  date: targetDate,
                  sequenceIndex: index + 1,
                  status: 'PENDING',
                })),
              }
            : undefined,
        },
        include: {
          driver: {
            include: {
              user: {
                select: { name: true, email: true },
              },
            },
          },
          assignments: {
            include: {
              order: true,
            },
          },
        },
      });

      if (dto.driverId) {
        // Emit socket event to the driver so their app instantly refetches
        this.trackingGateway.notifyOrderAssigned(dto.driverId, newRoute.id);
      }

      return newRoute;
    });
  }

  async findAll(query: GetRoutesQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const whereCondition: any = {};

    if (query.driverId) {
      whereCondition.driverId = query.driverId;
    }

    if (query.status) {
      whereCondition.status = query.status;
    }

    if (query.date) {
      const { startOfDay, endOfDay } = getLimaDayRange(query.date);
      whereCondition.date = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    const total = await this.prisma.route.count({ where: whereCondition });
    const routes = await this.prisma.route.findMany({
      where: whereCondition,
      include: {
        driver: {
          include: {
            user: {
              select: { name: true, email: true },
            },
          },
        },
        assignments: {
          where: { voidedAt: null },
          select: {
            id: true,
            status: true,
            sequenceIndex: true,
          },
        },
      },
      orderBy: [{ date: 'desc' }, { sequenceIndex: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    });

    const data = routes.map((r) => ({
      id: r.id,
      name: r.name,
      driverId: r.driverId,
      driverName: r.driver?.user?.name || null,
      unit: r.driver?.unit || null,
      date: r.date,
      sequenceIndex: r.sequenceIndex,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      overviewPolyline: r.overviewPolyline,
      ordersCount: r.assignments.length,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

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

  async findOne(id: string) {
    const route = await this.prisma.route.findUnique({
      where: { id },
      include: {
        driver: {
          include: {
            user: {
              select: { name: true, email: true },
            },
          },
        },
        assignments: {
          where: { voidedAt: null },
          orderBy: { sequenceIndex: 'asc' },
          include: {
            order: {
              include: {
                customer: {
                  include: { company: true },
                },
              },
            },
            vehicle: true,
            events: {
              orderBy: { timestamp: 'asc' },
            },
          },
        },
      },
    });

    if (!route) {
      throw new NotFoundException('Ruta no encontrada');
    }

    return route;
  }

  async deleteRoute(id: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const route = await tx.route.findUnique({
        where: { id },
        select: { id: true, status: true },
      });

      if (!route) {
        throw new NotFoundException('Ruta no encontrada');
      }

      if (route.status !== 'PENDING') {
        throw new BadRequestException('No se puede eliminar una ruta que ya está en progreso o completada.');
      }

      // 1. Eliminar asignaciones asociadas a la ruta para liberar los pedidos
      await tx.routeAssignment.deleteMany({
        where: { routeId: id, status: 'PENDING' },
      });

      // 2. Eliminación atómica garantizando que status === PENDING
      const result = await tx.route.deleteMany({
        where: {
          id,
          status: 'PENDING',
        },
      });

      if (result.count === 0) {
        throw new BadRequestException('La ruta ya no se encuentra en estado Pendiente y no pudo ser eliminada.');
      }

      return { success: true, message: 'Ruta eliminada correctamente' };
    });
  }

  async getMobileRoutes(driverId: string) {
    const today = getLimaDayRange().startOfDay;

    return this.prisma.route.findMany({
      where: {
        driverId,
        date: { gte: today },
        assignments: { some: {} },
      },
      include: {
        assignments: {
          include: {
            order: {
              include: {
                customer: true,
              },
            },
            evidences: true,
          },
          orderBy: { sequenceIndex: 'asc' },
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  async completeRoute(routeId: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const route = await tx.route.findUnique({ 
        where: { id: routeId },
        include: { assignments: { where: { voidedAt: null } } }
      });
      if (!route) throw new BadRequestException('Ruta no encontrada');

      const hasInTransit = route.assignments.some((a: any) => a.status === AssignmentStatus.IN_TRANSIT);
      if (hasInTransit) {
        throw new BadRequestException('Debes finalizar el pedido en tránsito antes de cerrar la ruta');
      }

      await tx.route.update({
        where: { id: routeId },
        data: { status: RouteStatus.COMPLETED, completedAt: new Date() },
      });

      // Cascada a OBSERVED solo para los pendientes
      await tx.routeAssignment.updateMany({
        where: {
          routeId: routeId,
          status: AssignmentStatus.PENDING,
          voidedAt: null,
        },
        data: { status: AssignmentStatus.OBSERVED, reasonText: 'Jornada finalizada por el chofer' },
      });

      return { success: true };
    });
  }
}
