import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { GeocodingService } from '../services/geocoding.service';
import { OrdersClientResolverService } from '../services/orders-client-resolver.service';
import { OrdersExcelParserService } from '../services/orders-excel-parser.service';
import { OrdersImportService } from '../services/orders-import.service';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentStatus } from '@prisma/client';

describe('OrdersService Phase 2 Validations', () => {
  let service: OrdersService;
  let prismaService: any;

  beforeEach(async () => {
    prismaService = {
      driverProfile: {
        findUnique: jest.fn(),
      },
      routeAssignment: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      orderEvent: {
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((promises) => Promise.all(promises)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prismaService },
        { provide: TrackingGateway, useValue: {} },
        { provide: GeocodingService, useValue: {} },
        { provide: OrdersClientResolverService, useValue: {} },
        { provide: OrdersExcelParserService, useValue: {} },
        { provide: OrdersImportService, useValue: {} },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('reorderAssignments', () => {
    it('should throw ForbiddenException if routeAssignment belongs to another driver', async () => {
      // Conductor autenticado
      prismaService.driverProfile.findUnique.mockResolvedValue({ id: 'driver-1', userId: 'user-1' });

      // Asignaciones en DB (una de ellas pertenece a driver-2)
      prismaService.routeAssignment.findMany.mockResolvedValue([
        { id: 'assign-1', driverId: 'driver-1' },
        { id: 'assign-2', driverId: 'driver-2' }, // Pertenece a otro conductor
      ]);

      await expect(
        service.reorderAssignments('user-1', {
          routeAssignmentIds: ['assign-1', 'assign-2'],
        }),
      ).rejects.toThrow(ForbiddenException);

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
