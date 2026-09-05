import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStopsGroupingService } from './order-stops-grouping.service';
import { AssignmentStatus } from '@prisma/client';
import { PauseOrderDto } from '../dto/pause-order.dto';

@Injectable()
export class OrderPausesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStopsGroupingService: OrderStopsGroupingService,
  ) {}

  async pauseOrder(orderId: string, dto: PauseOrderDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          assignments: {
            where: { voidedAt: null },
          },
        },
      });

      if (!order) {
        throw new NotFoundException('Pedido no encontrado');
      }

      if (order.isPaused) {
        throw new BadRequestException('El pedido ya se encuentra pausado');
      }

      // Validar tránsito: no se puede pausar un pedido actualmente en tránsito
      const inTransitAssignment = order.assignments.find(
        (a) => a.status === AssignmentStatus.IN_TRANSIT,
      );
      if (inTransitAssignment) {
        throw new BadRequestException(
          'No se puede pausar un pedido que se encuentra actualmente en tránsito.',
        );
      }

      // Anular atómicamente asignaciones PENDING activas
      const pendingAssignments = order.assignments.filter(
        (a) => a.status === AssignmentStatus.PENDING,
      );

      if (pendingAssignments.length > 0) {
        await tx.routeAssignment.updateMany({
          where: {
            orderId,
            voidedAt: null,
            status: AssignmentStatus.PENDING,
          },
          data: { voidedAt: new Date() },
        });

        // Deshacer paradas agrupadas si el grupo queda con 1 solo pedido
        for (const pa of pendingAssignments) {
          if (pa.stopGroupId) {
            await this.orderStopsGroupingService.handleOrderRemovedFromGroup(
              tx,
              pa.stopGroupId,
              pa.driverId,
              pa.date,
            );
          }
        }
      }

      // Actualización atómica con Compare-And-Swap (CAS)
      const result = await tx.order.updateMany({
        where: {
          id: orderId,
          isPaused: false, // Condición atómica de concurrencia
        },
        data: {
          isPaused: true,
          pauseReason: dto.reason,
          pausedAt: new Date(),
          pausedById: userId,
        },
      });

      if (result.count === 0) {
        throw new BadRequestException(
          'El pedido ya fue pausado por otro operador o no se encuentra disponible para pausar.',
        );
      }

      return tx.order.findUnique({
        where: { id: orderId },
        include: {
          pausedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    });
  }

  async resumeOrder(orderId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new NotFoundException('Pedido no encontrado');
      }

      if (!order.isPaused) {
        throw new BadRequestException('El pedido no se encuentra pausado');
      }

      // Actualización atómica con Compare-And-Swap (CAS)
      const result = await tx.order.updateMany({
        where: {
          id: orderId,
          isPaused: true, // Debe estar pausado para poder reanudarse
        },
        data: {
          isPaused: false,
          pauseReason: null,
          pausedAt: null,
          pausedById: null,
        },
      });

      if (result.count === 0) {
        throw new BadRequestException(
          'El pedido ya no se encuentra pausado o fue reanudado por otro operador.',
        );
      }

      return tx.order.findUnique({
        where: { id: orderId },
      });
    });
  }

  async findPausedOrders() {
    return this.prisma.order.findMany({
      where: { isPaused: true },
      include: {
        pausedBy: {
          select: { id: true, name: true, email: true },
        },
        customer: true,
        originBranch: true,
        assignments: {
          where: { voidedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            driver: {
              include: { user: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { pausedAt: 'desc' },
    });
  }
}
