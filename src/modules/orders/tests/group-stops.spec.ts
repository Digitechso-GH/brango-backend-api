import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from '../orders.service';
import { OrdersQueryService } from '../services/orders-query.service';
import { OrdersLifecycleService } from '../services/orders-lifecycle.service';
import { OrdersStatusService } from '../services/orders-status.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { GeocodingService } from '../services/geocoding.service';
import { OrdersClientResolverService } from '../services/orders-client-resolver.service';
import { OrdersExcelParserService } from '../services/orders-excel-parser.service';
import { OrdersImportService } from '../services/orders-import.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, RouteStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStopsGroupingService } from '../services/order-stops-grouping.service';

describe('OrdersService Multi-Order Stops (Group Stops)', () => {
  let service: OrdersService;
  let prismaService: any;
  let trackingGateway: any;

  beforeEach(async () => {
    prismaService = {
      routeAssignment: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      orderEvent: {
        create: jest.fn(),
      },
      evidence: {
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) =>
        typeof cb === 'function' ? cb(prismaService) : Promise.all(cb)
      ),
    };

    trackingGateway = {
      notifyStopsUpdated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        OrdersQueryService,
        OrdersLifecycleService,
        OrdersStatusService,
        { provide: PrismaService, useValue: prismaService },
        { provide: TrackingGateway, useValue: trackingGateway },
        { provide: GeocodingService, useValue: {} },
        { provide: OrdersClientResolverService, useValue: {} },
        { provide: OrdersExcelParserService, useValue: {} },
        { provide: OrdersImportService, useValue: {} },
        OrderStopsGroupingService,
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('groupStops', () => {
    it('should throw BadRequestException if route is IN_PROGRESS (lock enforcement)', async () => {
      const date = new Date('2026-09-04T05:00:00.000Z');
      prismaService.routeAssignment.findMany.mockResolvedValue([
        {
          id: 'assign-1',
          driverId: 'driver-1',
          date,
          status: AssignmentStatus.IN_TRANSIT,
          sequenceIndex: 1,
          route: { id: 'route-1', status: RouteStatus.IN_PROGRESS },
          order: { id: 'order-1', code: '1001', latitude: -12.04637, longitude: -77.04279 },
        },
        {
          id: 'assign-2',
          driverId: 'driver-1',
          date,
          status: AssignmentStatus.PENDING,
          sequenceIndex: 2,
          route: { id: 'route-1', status: RouteStatus.IN_PROGRESS },
          order: { id: 'order-2', code: '1002', latitude: -12.04637, longitude: -77.04279 },
        },
      ]);

      await expect(
        service.groupStops({ assignmentIds: ['assign-1', 'assign-2'] }, 'user-admin')
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully group stops if route is PENDING', async () => {
      const date = new Date('2026-09-04T05:00:00.000Z');
      prismaService.routeAssignment.findMany.mockResolvedValue([
        {
          id: 'assign-1',
          driverId: 'driver-1',
          date,
          status: AssignmentStatus.PENDING,
          sequenceIndex: 1,
          route: { id: 'route-1', status: RouteStatus.PENDING },
          order: { id: 'order-1', code: '1001', latitude: -12.04637, longitude: -77.04279 },
        },
        {
          id: 'assign-2',
          driverId: 'driver-1',
          date,
          status: AssignmentStatus.PENDING,
          sequenceIndex: 2,
          route: { id: 'route-1', status: RouteStatus.PENDING },
          order: { id: 'order-2', code: '1002', latitude: -12.04637, longitude: -77.04279 },
        },
      ]);

      prismaService.routeAssignment.updateMany.mockResolvedValue({ count: 2 });
      prismaService.orderEvent.create.mockResolvedValue({});

      const result = await service.groupStops(
        { assignmentIds: ['assign-1', 'assign-2'] },
        'user-admin'
      );

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.sequenceIndex).toBe(1);
      expect(prismaService.routeAssignment.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['assign-1', 'assign-2'] } },
        data: {
          stopGroupId: expect.any(String),
          sequenceIndex: 1,
        },
      });
      expect(trackingGateway.notifyStopsUpdated).toHaveBeenCalledWith('driver-1');
    });
  });

  describe('ungroupStop', () => {
    it('should throw BadRequestException if route is IN_PROGRESS', async () => {
      prismaService.routeAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        stopGroupId: 'group-uuid',
        status: AssignmentStatus.IN_TRANSIT,
        route: { id: 'route-1', status: RouteStatus.IN_PROGRESS },
      });

      await expect(
        service.ungroupStop({ assignmentId: 'assign-1' }, 'user-admin')
      ).rejects.toThrow(BadRequestException);
    });

    it('should ungroup assignment and dissolve group if only 1 assignment remains', async () => {
      const date = new Date('2026-09-04T05:00:00.000Z');
      prismaService.routeAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        driverId: 'driver-1',
        date,
        stopGroupId: 'group-uuid',
        status: AssignmentStatus.PENDING,
        route: { id: 'route-1', status: RouteStatus.PENDING },
      });

      prismaService.routeAssignment.update.mockResolvedValue({});
      // Remaining in group: only 1 other assignment
      prismaService.routeAssignment.findMany.mockResolvedValue([
        { id: 'assign-2', stopGroupId: 'group-uuid', sequenceIndex: 1 },
      ]);
      prismaService.orderEvent.create.mockResolvedValue({});

      const result = await service.ungroupStop({ assignmentId: 'assign-1' }, 'user-admin');

      expect(result.success).toBe(true);
      expect(prismaService.routeAssignment.update).toHaveBeenCalledWith({
        where: { id: 'assign-1' },
        data: { stopGroupId: null },
      });
      // Remaining assignment is also dissolved
      expect(prismaService.routeAssignment.update).toHaveBeenCalledWith({
        where: { id: 'assign-2' },
        data: { stopGroupId: null },
      });
      expect(trackingGateway.notifyStopsUpdated).toHaveBeenCalledWith('driver-1');
    });
  });

  describe('addGroupEvidence', () => {
    it('should create separate Evidence rows with the same S3 URL for all assignments in the group', async () => {
      prismaService.routeAssignment.findMany.mockResolvedValue([
        { id: 'assign-1' },
        { id: 'assign-2' },
      ]);
      prismaService.evidence.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: `evidence-${data.routeAssignmentId}`, ...data })
      );

      const result = await service.addGroupEvidence({
        assignmentIds: ['assign-1', 'assign-2'],
        s3Url: 'https://storage.example.com/shared-photo.jpg',
        signatureText: 'Recibido por Juan Pérez',
      });

      expect(result).toHaveLength(2);
      expect(prismaService.evidence.create).toHaveBeenCalledWith({
        data: {
          routeAssignmentId: 'assign-1',
          s3Url: 'https://storage.example.com/shared-photo.jpg',
          signatureText: 'Recibido por Juan Pérez',
        },
      });
      expect(prismaService.evidence.create).toHaveBeenCalledWith({
        data: {
          routeAssignmentId: 'assign-2',
          s3Url: 'https://storage.example.com/shared-photo.jpg',
          signatureText: 'Recibido por Juan Pérez',
        },
      });
    });
  });
});
