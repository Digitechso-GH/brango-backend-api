import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { GroupStopsDto } from '../dto/group-stops.dto';
import { UngroupStopDto } from '../dto/ungroup-stop.dto';
import { GroupEvidenceDto } from '../dto/group-evidence.dto';
import { AssignmentStatus, RouteStatus } from '@prisma/client';
import { getLimaDayjs, getLimaDayRange } from '../../../core/utils/date.util';
import { randomUUID } from 'crypto';

@Injectable()
export class OrderStopsGroupingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trackingGateway: TrackingGateway,
  ) {}

  async addGroupEvidence(dto: GroupEvidenceDto) {
    const assignments = await this.prisma.routeAssignment.findMany({
      where: { id: { in: dto.assignmentIds } },
    });

    if (assignments.length !== dto.assignmentIds.length) {
      throw new NotFoundException('Una o más asignaciones no fueron encontradas');
    }

    return this.prisma.$transaction(
      dto.assignmentIds.map((routeAssignmentId) =>
        this.prisma.evidence.create({
          data: {
            routeAssignmentId,
            s3Url: dto.s3Url,
            signatureText: dto.signatureText || null,
          },
        }),
      ),
    );
  }

  isSamePhysicalLocation(
    lat1?: number | null,
    lon1?: number | null,
    lat2?: number | null,
    lon2?: number | null,
  ): boolean {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
      return false;
    }
    const ROUNDING_FACTOR = 100000; // 5 decimales (~1.1 metros de precisión)
    const roundLat1 = Math.round(lat1 * ROUNDING_FACTOR) / ROUNDING_FACTOR;
    const roundLon1 = Math.round(lon1 * ROUNDING_FACTOR) / ROUNDING_FACTOR;
    const roundLat2 = Math.round(lat2 * ROUNDING_FACTOR) / ROUNDING_FACTOR;
    const roundLon2 = Math.round(lon2 * ROUNDING_FACTOR) / ROUNDING_FACTOR;

    return roundLat1 === roundLat2 && roundLon1 === roundLon2;
  }

  async normalizeDriverSequence(tx: any, driverId: string, date: Date) {
    const { startOfDay, endOfDay } = getLimaDayRange(date);

    const activeAssignments = await tx.routeAssignment.findMany({
      where: {
        driverId,
        date: { gte: startOfDay, lte: endOfDay },
        voidedAt: null,
      },
      orderBy: [{ sequenceIndex: 'asc' }, { createdAt: 'asc' }],
    });

    let currentSequence = 0;
    const processedStopGroups = new Map<string, number>();

    for (const a of activeAssignments) {
      if (a.stopGroupId) {
        if (processedStopGroups.has(a.stopGroupId)) {
          const targetSeq = processedStopGroups.get(a.stopGroupId)!;
          if (a.sequenceIndex !== targetSeq) {
            await tx.routeAssignment.update({
              where: { id: a.id },
              data: { sequenceIndex: targetSeq },
            });
          }
        } else {
          processedStopGroups.set(a.stopGroupId, currentSequence);
          if (a.sequenceIndex !== currentSequence) {
            await tx.routeAssignment.update({
              where: { id: a.id },
              data: { sequenceIndex: currentSequence },
            });
          }
          currentSequence++;
        }
      } else {
        if (a.sequenceIndex !== currentSequence) {
          await tx.routeAssignment.update({
            where: { id: a.id },
            data: { sequenceIndex: currentSequence },
          });
        }
        currentSequence++;
      }
    }
  }

  async getDuplicateStopSuggestions(dateStr?: string) {
    let dateWhere: any = undefined;
    if (dateStr) {
      const { startOfDay, endOfDay } = getLimaDayRange(dateStr);
      dateWhere = { gte: startOfDay, lte: endOfDay };
    }

    const assignments = await this.prisma.routeAssignment.findMany({
      where: {
        ...(dateWhere ? { date: dateWhere } : {}),
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT] },
        voidedAt: null,
        OR: [
          { routeId: null },
          { route: { status: { notIn: [RouteStatus.COMPLETED] } } },
        ],
      },
      include: {
        order: {
          include: {
            customer: true,
          },
        },
        driver: {
          include: {
            user: true,
          },
        },
        route: true,
      },
      orderBy: [
        { driverId: 'asc' },
        { sequenceIndex: 'asc' },
      ],
    });

    const groups: Array<{
      groupId: string | null;
      isGrouped: boolean;
      address: string;
      latitude: number | null;
      longitude: number | null;
      driverId: string | null;
      driverName: string | null;
      unit: string | null;
      routeId: string | null;
      routeStatus: string | null;
      canModify: boolean;
      assignments: Array<{
        id: string;
        orderId: string;
        orderCode: string;
        waybill: string | null;
        clientName: string;
        recipientName: string | null;
        recipientPhone: string | null;
        status: string;
        sequenceIndex: number;
        stopGroupId: string | null;
      }>;
    }> = [];

    // 1. Recolectar grupos ya existentes (con stopGroupId)
    const existingGroupMap = new Map<string, typeof assignments>();
    const ungroupedAssignments: typeof assignments = [];

    for (const a of assignments) {
      if (a.stopGroupId) {
        if (!existingGroupMap.has(a.stopGroupId)) {
          existingGroupMap.set(a.stopGroupId, []);
        }
        existingGroupMap.get(a.stopGroupId)!.push(a);
      } else {
        ungroupedAssignments.push(a);
      }
    }

    for (const [groupId, items] of existingGroupMap.entries()) {
      if (items.length >= 2) {
        const first = items[0];
        const routeStatus = first.route?.status || null;
        groups.push({
          groupId,
          isGrouped: true,
          address: first.order.formattedAddress || first.order.rawAddress,
          latitude: first.order.latitude,
          longitude: first.order.longitude,
          driverId: first.driverId,
          driverName: first.driver?.user?.name || null,
          unit: first.driver?.unit || null,
          routeId: first.routeId,
          routeStatus,
          canModify: !routeStatus || routeStatus === RouteStatus.PENDING,
          assignments: items.map((it) => ({
            id: it.id,
            orderId: it.orderId,
            orderCode: it.order.code,
            waybill: it.order.waybill,
            clientName: it.order.customer?.name || it.order.recipientName || 'Cliente',
            recipientName: it.order.recipientName,
            recipientPhone: it.order.recipientPhone,
            status: it.status,
            sequenceIndex: it.sequenceIndex,
            stopGroupId: it.stopGroupId,
          })),
        });
      }
    }

    // 2. Descubrir duplicados sugeridos entre asignaciones no agrupadas
    const visited = new Set<string>();

    for (let i = 0; i < ungroupedAssignments.length; i++) {
      const a = ungroupedAssignments[i];
      if (visited.has(a.id)) continue;
      if (a.order.latitude == null || a.order.longitude == null) continue;

      const cluster = [a];

      for (let j = i + 1; j < ungroupedAssignments.length; j++) {
        const b = ungroupedAssignments[j];
        if (visited.has(b.id)) continue;
        if (b.order.latitude == null || b.order.longitude == null) continue;

        if (a.driverId !== b.driverId) continue;
        if (a.routeId !== b.routeId) continue;

        // Deben ser para la misma fecha programada de entrega
        const dateA = getLimaDayjs(a.date).format('YYYY-MM-DD');
        const dateB = getLimaDayjs(b.date).format('YYYY-MM-DD');
        if (dateA !== dateB) continue;

        const isMatch = this.isSamePhysicalLocation(
          a.order.latitude,
          a.order.longitude,
          b.order.latitude,
          b.order.longitude,
        );

        if (isMatch) {
          cluster.push(b);
          visited.add(b.id);
        }
      }

      if (cluster.length >= 2) {
        visited.add(a.id);
        const first = cluster[0];
        const routeStatus = first.route?.status || null;
        groups.push({
          groupId: null,
          isGrouped: false,
          address: first.order.formattedAddress || first.order.rawAddress,
          latitude: first.order.latitude,
          longitude: first.order.longitude,
          driverId: first.driverId,
          driverName: first.driver?.user?.name || null,
          unit: first.driver?.unit || null,
          routeId: first.routeId,
          routeStatus,
          canModify: !routeStatus || routeStatus === RouteStatus.PENDING,
          assignments: cluster.map((it) => ({
            id: it.id,
            orderId: it.orderId,
            orderCode: it.order.code,
            waybill: it.order.waybill,
            clientName: it.order.customer?.name || it.order.recipientName || 'Cliente',
            recipientName: it.order.recipientName,
            recipientPhone: it.order.recipientPhone,
            status: it.status,
            sequenceIndex: it.sequenceIndex,
            stopGroupId: it.stopGroupId,
          })),
        });
      }
    }

    return groups;
  }

  async groupStops(dto: GroupStopsDto, userId?: string) {
    const assignments = await this.prisma.routeAssignment.findMany({
      where: { id: { in: dto.assignmentIds } },
      include: { route: true, order: true },
    });

    if (assignments.length !== dto.assignmentIds.length) {
      throw new NotFoundException('Una o más asignaciones no fueron encontradas');
    }

    const firstDriverId = assignments[0].driverId;
    const differentDriver = assignments.some((a) => a.driverId !== firstDriverId);
    if (differentDriver) {
      throw new BadRequestException('Solo se pueden agrupar pedidos asignados al mismo conductor');
    }

    const firstDate = getLimaDayjs(assignments[0].date).format('YYYY-MM-DD');
    const differentDate = assignments.some((a) => getLimaDayjs(a.date).format('YYYY-MM-DD') !== firstDate);
    if (differentDate) {
      throw new BadRequestException('Todos los pedidos a consolidar deben pertenecer a la misma fecha');
    }

    const firstLat = assignments[0].order.latitude;
    const firstLng = assignments[0].order.longitude;
    const differentLocation = assignments.some(
      (a) => !this.isSamePhysicalLocation(firstLat, firstLng, a.order.latitude, a.order.longitude),
    );
    if (differentLocation) {
      throw new BadRequestException('Todos los pedidos a consolidar deben compartir la misma ubicación física exacta (coordenadas a 5 decimales)');
    }

    // CANDADO DE ESTADO: Validar que la Route esté en estado PENDING
    for (const a of assignments) {
      if (a.route && a.route.status !== RouteStatus.PENDING) {
        throw new BadRequestException(
          `No se pueden agrupar pedidos de una ruta en estado ${a.route.status}. Solo se permiten rutas pendientes.`,
        );
      }
    }

    const finished = assignments.some(
      (a) => a.status === AssignmentStatus.DELIVERED || a.status === AssignmentStatus.OBSERVED,
    );
    if (finished) {
      throw new BadRequestException('No se pueden agrupar pedidos que ya fueron entregados u observados');
    }

    const targetStopGroupId = randomUUID();
    const minSequence = Math.min(...assignments.map((a) => a.sequenceIndex));

    return this.prisma.$transaction(async (tx: any) => {
      await tx.routeAssignment.updateMany({
        where: { id: { in: dto.assignmentIds } },
        data: {
          stopGroupId: targetStopGroupId,
          sequenceIndex: minSequence,
        },
      });

      if (firstDriverId) {
        await this.normalizeDriverSequence(tx, firstDriverId, assignments[0].date);
      }

      for (const a of assignments) {
        await tx.orderEvent.create({
          data: {
            routeAssignmentId: a.id,
            type: 'STOP_GROUPED',
            actor: userId || 'system',
            metadata: {
              stopGroupId: targetStopGroupId,
              groupedWith: dto.assignmentIds.filter((id) => id !== a.id),
            },
          },
        });
      }

      if (firstDriverId) {
        this.trackingGateway.notifyStopsUpdated(firstDriverId);
      }

      return {
        success: true,
        stopGroupId: targetStopGroupId,
        sequenceIndex: minSequence,
        count: dto.assignmentIds.length,
      };
    });
  }

  async ungroupStop(dto: UngroupStopDto, userId?: string) {
    const assignment = await this.prisma.routeAssignment.findUnique({
      where: { id: dto.assignmentId },
      include: { route: true },
    });

    if (!assignment) {
      throw new NotFoundException('Asignación no encontrada');
    }

    if (!assignment.stopGroupId) {
      throw new BadRequestException('El pedido no pertenece a ninguna parada consolidada');
    }

    // CANDADO DE ESTADO: Validar que la Route esté en estado PENDING
    if (assignment.route && assignment.route.status !== RouteStatus.PENDING) {
      throw new BadRequestException(
        `No se puede desagrupar un pedido de una ruta en estado ${assignment.route.status}. Solo se permiten rutas pendientes.`,
      );
    }

    if (assignment.status === AssignmentStatus.DELIVERED || assignment.status === AssignmentStatus.OBSERVED) {
      throw new BadRequestException('No se puede desagrupar un pedido que ya fue entregado u observado');
    }

    const oldStopGroupId = assignment.stopGroupId;

    return this.prisma.$transaction(async (tx: any) => {
      await tx.routeAssignment.update({
        where: { id: dto.assignmentId },
        data: { stopGroupId: null },
      });

      const remainingInGroup = await tx.routeAssignment.findMany({
        where: { stopGroupId: oldStopGroupId },
      });

      if (remainingInGroup.length === 1) {
        await tx.routeAssignment.update({
          where: { id: remainingInGroup[0].id },
          data: { stopGroupId: null },
        });
      }

      if (assignment.driverId) {
        await this.normalizeDriverSequence(tx, assignment.driverId, assignment.date);
      }

      await tx.orderEvent.create({
        data: {
          routeAssignmentId: assignment.id,
          type: 'STOP_UNGROUPED',
          actor: userId || 'system',
          metadata: {
            previousStopGroupId: oldStopGroupId,
          },
        },
      });

      if (assignment.driverId) {
        this.trackingGateway.notifyStopsUpdated(assignment.driverId);
      }

      return { success: true };
    });
  }

  async handleOrderRemovedFromGroup(tx: any, stopGroupId: string, driverId?: string, date?: Date) {
    const remainingInGroup = await tx.routeAssignment.findMany({
      where: { stopGroupId, voidedAt: null },
    });

    if (remainingInGroup.length === 1) {
      await tx.routeAssignment.update({
        where: { id: remainingInGroup[0].id },
        data: { stopGroupId: null },
      });
    }

    if (driverId && date) {
      await this.normalizeDriverSequence(tx, driverId, date);
      this.trackingGateway.notifyStopsUpdated(driverId);
    }
  }
}
