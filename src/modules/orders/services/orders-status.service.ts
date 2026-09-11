import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { GeocodingService } from './geocoding.service';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { ReorderAssignmentsDto } from '../dto/reorder-assignments.dto';
import { AssignmentStatus, RouteStatus, Prisma } from '@prisma/client';
import { getLimaDayRange, getLimaDayjs } from '../../../core/utils/date.util';
import { ORDER_EVENT_TYPES } from '../constants/order-events.constants';

@Injectable()
export class OrdersStatusService {
  private readonly logger = new Logger(OrdersStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingGateway: TrackingGateway,
    private readonly geocodingService: GeocodingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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
          type: dto.status === AssignmentStatus.IN_TRANSIT ? ORDER_EVENT_TYPES.TRANSIT_STARTED : dto.status,
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
              type: ORDER_EVENT_TYPES.TRANSIT_STARTED,
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
              status: RouteStatus.IN_PROGRESS,
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
                status: RouteStatus.COMPLETED,
                completedAt: new Date(),
              },
            });
          } else {
            await tx.route.update({
              where: { id: existing.routeId },
              data: {
                status: RouteStatus.IN_PROGRESS,
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
}
