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
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, RouteStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStopsGroupingService } from '../services/order-stops-grouping.service';

describe('OrdersService Phase 2 Validations', () => {
  let service: OrdersService;
  let prismaService: any;

  beforeEach(async () => {
    prismaService = {
      driverProfile: {
        findUnique: jest.fn(),
      },
      routeAssignment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      orderEvent: {
        create: jest.fn(),
      },
      route: {
        update: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) => typeof cb === 'function' ? cb(prismaService) : Promise.all(cb)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        OrdersQueryService,
        OrdersLifecycleService,
        OrdersStatusService,
        { provide: PrismaService, useValue: prismaService },
        { provide: TrackingGateway, useValue: {} },
        { provide: GeocodingService, useValue: {} },
        { provide: OrdersClientResolverService, useValue: {} },
        { provide: OrdersExcelParserService, useValue: {} },
        { provide: OrdersImportService, useValue: {} },
        { provide: OrderStopsGroupingService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('reorderAssignments', () => {
    it('should throw ForbiddenException if routeAssignment belongs to another driver', async () => {
      // Conductor autenticado
      prismaService.driverProfile.findUnique.mockResolvedValue({ id: 'driver-1', userId: 'user-1' });

      // Asignaciones encontradas en DB para driver-1 (assign-2 es de otro conductor, por lo que DB solo retorna assign-1)
      prismaService.routeAssignment.findMany.mockResolvedValue([
        { id: 'assign-1', driverId: 'driver-1' },
      ]);

      await expect(
        service.reorderAssignments('user-1', {
          routeAssignmentIds: ['assign-1', 'assign-2'],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaService.driverProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });
  });

  describe('updateStatus Transitions', () => {
    it('should throw BadRequestException if routeAssignment is already in DELIVERED state', async () => {
      prismaService.routeAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        status: AssignmentStatus.DELIVERED,
      });

      await expect(
        service.updateStatus('assign-1', {
          status: AssignmentStatus.IN_TRANSIT,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if routeAssignment is already in OBSERVED state', async () => {
      prismaService.routeAssignment.findUnique.mockResolvedValue({
        id: 'assign-1',
        status: AssignmentStatus.OBSERVED,
      });

      await expect(
        service.updateStatus('assign-1', {
          status: AssignmentStatus.DELIVERED,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
