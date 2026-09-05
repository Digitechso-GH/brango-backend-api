import { Test, TestingModule } from '@nestjs/testing';
import { OrderPausesService } from '../services/order-pauses.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStopsGroupingService } from '../services/order-stops-grouping.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AssignmentStatus } from '@prisma/client';

describe('OrderPausesService', () => {
  let service: OrderPausesService;
  let prisma: any;
  let groupingService: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb) => cb(prisma)),
      order: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      routeAssignment: {
        updateMany: jest.fn(),
      },
    };

    groupingService = {
      handleOrderRemovedFromGroup: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderPausesService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrderStopsGroupingService, useValue: groupingService },
      ],
    }).compile();

    service = module.get<OrderPausesService>(OrderPausesService);
  });

  describe('pauseOrder', () => {
    it('debe lanzar NotFoundException si el pedido no existe', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.pauseOrder('order-1', { reason: 'Sin stock' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar BadRequestException si el pedido ya está pausado', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        isPaused: true,
        assignments: [],
      });

      await expect(
        service.pauseOrder('order-1', { reason: 'Sin stock' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar BadRequestException si el pedido tiene una asignación IN_TRANSIT', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        isPaused: false,
        assignments: [
          { id: 'assign-1', status: AssignmentStatus.IN_TRANSIT },
        ],
      });

      await expect(
        service.pauseOrder('order-1', { reason: 'Sin stock' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe anular asignaciones PENDING, manejar stopGroupId y pausar el pedido', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce({
          id: 'order-1',
          isPaused: false,
          assignments: [
            {
              id: 'assign-1',
              status: AssignmentStatus.PENDING,
              stopGroupId: 'grp-1',
              driverId: 'driver-1',
              date: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'order-1',
          isPaused: true,
          pauseReason: 'Sin stock',
        });

      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.routeAssignment.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.pauseOrder(
        'order-1',
        { reason: 'Sin stock' },
        'user-1',
      );

      expect(prisma.routeAssignment.updateMany).toHaveBeenCalledWith({
        where: {
          orderId: 'order-1',
          voidedAt: null,
          status: AssignmentStatus.PENDING,
        },
        data: expect.objectContaining({ voidedAt: expect.any(Date) }),
      });

      expect(groupingService.handleOrderRemovedFromGroup).toHaveBeenCalledWith(
        expect.anything(),
        'grp-1',
        'driver-1',
        expect.any(Date),
      );

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', isPaused: false },
        data: expect.objectContaining({
          isPaused: true,
          pauseReason: 'Sin stock',
          pausedById: 'user-1',
        }),
      });

      expect(result).toBeDefined();
    });

    it('debe lanzar BadRequestException si updateMany devuelve count: 0 (condición de carrera)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        isPaused: false,
        assignments: [],
      });

      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.pauseOrder('order-1', { reason: 'Sin stock' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resumeOrder', () => {
    it('debe lanzar NotFoundException si el pedido no existe', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.resumeOrder('order-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('debe lanzar BadRequestException si el pedido no está pausado', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        isPaused: false,
      });

      await expect(service.resumeOrder('order-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('debe reanudar el pedido limpiando pauseReason y pausedAt', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce({
          id: 'order-1',
          isPaused: true,
          pauseReason: 'Sin stock',
        })
        .mockResolvedValueOnce({
          id: 'order-1',
          isPaused: false,
          pauseReason: null,
        });

      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.resumeOrder('order-1', 'user-1');

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', isPaused: true },
        data: {
          isPaused: false,
          pauseReason: null,
          pausedAt: null,
          pausedById: null,
        },
      });

      expect(result).toBeDefined();
    });

    it('debe lanzar BadRequestException si updateMany devuelve count: 0 en resume (condición de carrera)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        isPaused: true,
      });

      prisma.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.resumeOrder('order-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
