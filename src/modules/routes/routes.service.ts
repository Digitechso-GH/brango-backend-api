import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRouteDto, GetRoutesQueryDto } from './routes.dto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);
const TIMEZONE = 'America/Lima';

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaService) {}

  async createRoute(dto: CreateRouteDto) {
    const targetDate = dayjs.tz(dto.date, TIMEZONE).startOf('day').toDate();
    const endOfDay = dayjs.tz(dto.date, TIMEZONE).endOf('day').toDate();
    const assignments = dto.assignments || [];

    return this.prisma.$transaction(async (tx: any) => {
      // 1. Validar que el chofer no tenga ya una ruta IN_PROGRESS
      const inProgressRoute = await tx.route.findFirst({
        where: { driverId: dto.driverId, status: 'IN_PROGRESS' },
      });
      if (inProgressRoute) {
        throw new BadRequestException('El chofer ya tiene una ruta IN_PROGRESS. No se puede crear otra.');
      }

      // 2. Validar duplicidad de pedidos si se proporcionan asignaciones
      if (assignments.length > 0) {
        const orderIds = assignments.map((a) => a.orderId);
        const existingAssignments = await tx.routeAssignment.findFirst({
          where: {
            orderId: { in: orderIds },
            voidedAt: null,
          },
        });

        if (existingAssignments) {
          throw new BadRequestException(
            `El pedido con ID ${existingAssignments.orderId} ya tiene una asignación vigente en otra ruta.`,
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
      const startOfDay = dayjs.tz(query.date, TIMEZONE).startOf('day').toDate();
      const endOfDay = dayjs.tz(query.date, TIMEZONE).endOf('day').toDate();
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
      driverName: r.driver?.user?.name || 'Chofer Desconocido',
      unit: r.driver?.unit || null,
      date: r.date,
      sequenceIndex: r.sequenceIndex,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
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
    const today = dayjs().tz(TIMEZONE).startOf('day').toDate();

    return this.prisma.route.findMany({
      where: {
        driverId,
        date: { gte: today },
        assignments: { some: {} },
      },
      include: {
        assignments: {
          include: {
            order: true,
          },
          orderBy: { sequenceIndex: 'asc' },
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  async completeRoute(routeId: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const route = await tx.route.findUnique({ where: { id: routeId } });
      if (!route) throw new BadRequestException('Ruta no encontrada');

      await tx.route.update({
        where: { id: routeId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      // Cascada a OBSERVED para los pendientes
      await tx.routeAssignment.updateMany({
        where: {
          routeId: routeId,
          status: { in: ['PENDING', 'IN_TRANSIT'] },
          voidedAt: null,
        },
        data: { status: 'OBSERVED', reasonText: 'Jornada terminada por el chofer' },
      });

      return { success: true };
    });
  }
}
