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
    const todayStart = getLimaDayRange().startOfDay;

    if (targetDate < todayStart) {
      throw new BadRequestException('No se pueden programar rutas en fechas pasadas.');
    }

    const assignments = dto.assignments || [];

    return this.prisma.$transaction(async (tx: any) => {
      // 1. Validar que el chofer no tenga ya una ruta activa con pedidos activos en la misma fecha
      const activeRouteSameDay = await tx.route.findFirst({
        where: { 
          driverId: dto.driverId, 
          date: { gte: targetDate, lte: endOfDay },
          status: { in: [RouteStatus.PENDING, RouteStatus.IN_PROGRESS] },
          assignments: { some: { voidedAt: null } },
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

  async cancelRoute(id: string, actor: string = 'system') {
    return this.prisma.$transaction(async (tx: any) => {
      const route = await tx.route.findUnique({
        where: { id },
        select: { id: true, status: true, driverId: true },
      });

      if (!route) {
        throw new NotFoundException('Ruta no encontrada');
      }

      if (route.status !== RouteStatus.PENDING) {
        throw new BadRequestException('Solo se pueden cancelar rutas que se encuentren en estado Pendiente.');
      }

      // 1. Marcar asignaciones activas como voidedAt y registrar OrderEvent
      const pendingAssignments = await tx.routeAssignment.findMany({
        where: { routeId: id, status: AssignmentStatus.PENDING, voidedAt: null },
      });

      for (const assignment of pendingAssignments) {
        await tx.routeAssignment.update({
          where: { id: assignment.id },
          data: { voidedAt: new Date() },
        });

        await tx.orderEvent.create({
          data: {
            routeAssignmentId: assignment.id,
            type: 'DRIVER_UNASSIGNED',
            actor,
            metadata: { note: 'Ruta cancelada por operador' },
          },
        });
      }

      // 2. Actualizar estado de la ruta a CANCELLED (sin borrado físico)
      const updatedRoute = await tx.route.update({
        where: { id },
        data: { status: RouteStatus.CANCELLED },
      });

      return { success: true, message: 'Ruta cancelada correctamente', route: updatedRoute };
    });
  }

  async deleteRoute(id: string) {
    return this.cancelRoute(id, 'system');
  }

  async getMobileRoutes(driverId: string) {
    const { startOfDay: todayStart } = getLimaDayRange();

    return this.prisma.route.findMany({
      where: {
        driverId,
        status: { not: RouteStatus.CANCELLED },
        assignments: { some: { voidedAt: null } },
        OR: [
          // 1. Todas las rutas no cerradas (pasadas sin cerrar, de hoy o futuras)
          {
            status: { in: [RouteStatus.PENDING, RouteStatus.IN_PROGRESS] },
          },
          // 2. Rutas completadas hoy (historial de jornada del chofer para hoy)
          {
            status: RouteStatus.COMPLETED,
            completedAt: { gte: todayStart },
          },
        ],
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

  // =========================================================================
  // [PROVISIONAL - PENDIENTE DE CONFIRMACIÓN DE NEGOCIO POR EL CLIENTE]
  // Función: Forzar Cierre Administrativo de Ruta en Curso o Pendiente.
  // Permite a un administrador cerrar una ruta ante contingencias (chofer
  // ausente, teléfono inoperativo). Si el cliente decide mantener la regla
  // estricta ("Solo el chofer cierra"), este método y su endpoint en
  // routes.controller.ts serán eliminados de inmediato.
  // =========================================================================
  async forceCloseRouteByAdmin(routeId: string, actor: string = 'admin', reason?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const route = await tx.route.findUnique({
        where: { id: routeId },
        include: { assignments: { where: { voidedAt: null } } },
      });
      if (!route) throw new NotFoundException('Ruta no encontrada');

      if (route.status === RouteStatus.COMPLETED) {
        throw new BadRequestException('Esta ruta ya se encuentra completada y cerrada.');
      }
      if (route.status === RouteStatus.CANCELLED) {
        throw new BadRequestException('No se puede forzar el cierre de una ruta cancelada.');
      }

      // 1. Cerrar ruta forzosamente
      const updatedRoute = await tx.route.update({
        where: { id: routeId },
        data: {
          status: RouteStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      // 2. Pasar pedidos no entregados a OBSERVED
      const uncompletedAssignments = route.assignments.filter(
        (a: any) => a.status === AssignmentStatus.PENDING || a.status === AssignmentStatus.IN_TRANSIT,
      );

      for (const assignment of uncompletedAssignments) {
        await tx.routeAssignment.update({
          where: { id: assignment.id },
          data: {
            status: AssignmentStatus.OBSERVED,
            reasonText: reason || 'Ruta cerrada forzosamente por contingencia administrativa',
          },
        });

        await tx.orderEvent.create({
          data: {
            routeAssignmentId: assignment.id,
            type: 'FORCE_CLOSED_BY_ADMIN',
            actor,
            metadata: {
              note: reason || 'Cierre forzado por administrador por contingencia del chofer',
              previousStatus: assignment.status,
            },
          },
        });
      }

      return {
        success: true,
        message: 'Ruta cerrada forzosamente por el administrador correctamente',
        route: updatedRoute,
      };
    });
  }

  async completeRoute(routeId: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const route = await tx.route.findUnique({ 
        where: { id: routeId },
        include: { assignments: { where: { voidedAt: null } } }
      });
      if (!route) throw new BadRequestException('Ruta no encontrada');

      if (route.status === RouteStatus.COMPLETED) {
        throw new BadRequestException('Esta ruta ya fue cerrada previamente por un administrador o por el sistema.');
      }

      const hasInTransit = route.assignments.some((a: any) => a.status === AssignmentStatus.IN_TRANSIT);
      if (hasInTransit) {
        throw new BadRequestException('Debes finalizar el pedido en tránsito antes de cerrar la ruta');
      }

      // Validar orden secuencial: No se puede cerrar una ruta si existe una ruta previa abierta
      const { startOfDay: targetDayStart, endOfDay: targetDayEnd } = getLimaDayRange(route.date);
      const priorOpenRoute = await tx.route.findFirst({
        where: {
          driverId: route.driverId,
          id: { not: route.id },
          status: { in: [RouteStatus.PENDING, RouteStatus.IN_PROGRESS] },
          assignments: {
            some: {
              voidedAt: null,
              status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] },
            },
          },
          OR: [
            // (a) Fecha estrictamente anterior
            { date: { lt: targetDayStart } },
            // (b) Misma fecha, pero sequenceIndex menor
            {
              date: { gte: targetDayStart, lte: targetDayEnd },
              sequenceIndex: { lt: route.sequenceIndex },
            },
          ],
        },
      });

      if (priorOpenRoute) {
        throw new BadRequestException(
          'No puedes cerrar esta ruta porque tienes una ruta anterior abierta pendiente de cierre.',
        );
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
