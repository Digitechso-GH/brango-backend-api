import { Injectable, Logger } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ReorderAssignmentsDto } from './dto/reorder-assignments.dto';
import { GroupStopsDto } from './dto/group-stops.dto';
import { UngroupStopDto } from './dto/ungroup-stop.dto';
import { GroupEvidenceDto } from './dto/group-evidence.dto';
import { Prisma } from '@prisma/client';
import { OrdersQueryService } from './services/orders-query.service';
import { OrdersLifecycleService } from './services/orders-lifecycle.service';
import { OrdersStatusService } from './services/orders-status.service';
import { OrdersImportService } from './services/orders-import.service';
import { OrderStopsGroupingService } from './services/order-stops-grouping.service';

/**
 * OrdersService (Facade)
 *
 * Facade arquitectónica que delega responsabilidades a los sub-servicios especializados:
 * - OrdersQueryService: Búsqueda, paginación, filtros de Torre de Control y tracking público.
 * - OrdersLifecycleService: Creación, actualización atómica, reasignaciones y cierre EOD.
 * - OrdersStatusService: Transiciones de estado, evidencias y reordenamiento de ruta.
 * - OrdersImportService: Procesamiento e importación masiva de Excel.
 * - OrderStopsGroupingService: Consolidación y agrupación de paradas (stopGroupId).
 *
 * Preserva 100% la interfaz pública existente para controladores y servicios dependientes.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly ordersQueryService: OrdersQueryService,
    private readonly ordersLifecycleService: OrdersLifecycleService,
    private readonly ordersStatusService: OrdersStatusService,
    private readonly importService: OrdersImportService,
    private readonly orderStopsGroupingService: OrderStopsGroupingService,
  ) {}

  // ==========================================
  // Lifecycle & Mutaciones (OrdersLifecycleService)
  // ==========================================

  async create(dto: CreateOrderDto, creatorId?: string) {
    return this.ordersLifecycleService.create(dto, creatorId);
  }

  async update(id: string, dto: UpdateOrderDto) {
    return this.ordersLifecycleService.update(id, dto);
  }

  async remove(id: string) {
    return this.ordersLifecycleService.remove(id);
  }

  async reassignAssignment(
    previousAssignmentId: string,
    dto: { driverId: string; vehicleId?: string; date: string },
    userId: string,
  ) {
    return this.ordersLifecycleService.reassignAssignment(previousAssignmentId, dto, userId);
  }

  async executeEodRouteCascadeClosure(): Promise<number> {
    return this.ordersLifecycleService.executeEodRouteCascadeClosure();
  }

  async executeAutoClosure(whereClause: Prisma.RouteAssignmentWhereInput): Promise<number> {
    return this.ordersLifecycleService.executeAutoClosure(whereClause);
  }

  async cleanEmptyRouteIfNeeded(routeId: string, tx?: any) {
    return this.ordersLifecycleService.cleanEmptyRouteIfNeeded(routeId, tx);
  }

  // ==========================================
  // Consultas & Lectura (OrdersQueryService)
  // ==========================================

  async findAll(search?: string, page: number = 1, limit: number = 20, driverId?: string) {
    return this.ordersQueryService.findAll(search, page, limit, driverId);
  }

  async findToday(driverIdOrUserId?: string) {
    return this.ordersQueryService.findToday(driverIdOrUserId);
  }

  async findOne(id: string) {
    return this.ordersQueryService.findOne(id);
  }

  async getConfig() {
    return this.ordersQueryService.getConfig();
  }

  async updateConfig(config: Record<string, string>) {
    return this.ordersQueryService.updateConfig(config);
  }

  async getPublicTracking(token: string) {
    return this.ordersQueryService.getPublicTracking(token);
  }

  // ==========================================
  // Estados, Evidencias & Ruta (OrdersStatusService)
  // ==========================================

  async updateStatus(routeAssignmentId: string, dto: UpdateOrderStatusDto) {
    return this.ordersStatusService.updateStatus(routeAssignmentId, dto);
  }

  async addEvidence(routeAssignmentId: string, s3Url: string, signatureText?: string) {
    return this.ordersStatusService.addEvidence(routeAssignmentId, s3Url, signatureText);
  }

  async reorderAssignments(userId: string, dto: ReorderAssignmentsDto) {
    return this.ordersStatusService.reorderAssignments(userId, dto);
  }

  async assertNoUnclosedPriorRoutes(
    driverId: string,
    targetDate: Date | string,
    currentSequenceIndex?: number,
    excludeRouteId?: string,
  ): Promise<void> {
    return this.ordersStatusService.assertNoUnclosedPriorRoutes(
      driverId,
      targetDate,
      currentSequenceIndex,
      excludeRouteId,
    );
  }

  // ==========================================
  // Importaciones & Agrupaciones
  // ==========================================

  async importExcel(fileBuffer: Buffer, operatorId?: string) {
    return this.ordersLifecycleService.importExcel(fileBuffer, operatorId);
  }

  async addGroupEvidence(dto: GroupEvidenceDto) {
    return this.orderStopsGroupingService.addGroupEvidence(dto);
  }

  async getDuplicateStopSuggestions(dateStr?: string) {
    return this.orderStopsGroupingService.getDuplicateStopSuggestions(dateStr);
  }

  async groupStops(dto: GroupStopsDto, userId?: string) {
    return this.orderStopsGroupingService.groupStops(dto, userId);
  }

  async ungroupStop(dto: UngroupStopDto, userId?: string) {
    return this.orderStopsGroupingService.ungroupStop(dto, userId);
  }
}
