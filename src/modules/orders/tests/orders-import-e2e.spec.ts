import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { GeocodingService } from '../services/geocoding.service';
import { OrdersClientResolverService } from '../services/orders-client-resolver.service';
import { OrdersExcelParserService } from '../services/orders-excel-parser.service';
import { OrdersImportService } from '../services/orders-import.service';
import { OrderStopsGroupingService } from '../services/order-stops-grouping.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('OrdersService - importExcel E2E integration test', () => {
  let ordersService: OrdersService;
  let prismaService: any;
  let excelParserService: any;
  let clientResolverService: any;
  let trackingGateway: any;

  beforeEach(async () => {
    prismaService = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'op-123' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'op-123' }),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(prismaService)),
    };

    excelParserService = {
      parseAndValidateExcelBuffer: jest.fn(),
    };

    clientResolverService = {
      resolveOrCreateClient: jest.fn().mockResolvedValue('cli-99'),
    };

    trackingGateway = {
      notifyOrderAssigned: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        OrdersImportService,
        { provide: PrismaService, useValue: prismaService },
        { provide: OrdersExcelParserService, useValue: excelParserService },
        { provide: OrdersClientResolverService, useValue: clientResolverService },
        { provide: GeocodingService, useValue: {} },
        { provide: OrderStopsGroupingService, useValue: {} },
        { provide: TrackingGateway, useValue: trackingGateway },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    ordersService = module.get<OrdersService>(OrdersService);
  });

  it('should process valid rows, pre-resolve clients and perform atomic transaction insert', async () => {
    const validRows: any[] = [
      {
        rowNumber: 2,
        code: 'PED-500',
        recipientCustomerType: 'PERSONA',
        recipientDocument: '12345678',
        recipientName: 'Juan Perez',
        rawAddress: 'Av. Brasil 100',
        formattedAddress: 'Av. Brasil 100, Lima',
        latitude: -12.05,
        longitude: -77.03,
        geocodingStatus: 'SUCCESS',
      },
      {
        rowNumber: 3,
        code: 'PED-501',
        recipientCustomerType: 'PERSONA',
        recipientDocument: '87654321',
        recipientName: 'Maria Lopez',
        rawAddress: 'Av. Arequipa 500',
        formattedAddress: 'Av. Arequipa 500, Lima',
        latitude: null,
        longitude: null,
        geocodingStatus: 'FAILED',
      },
    ];

    excelParserService.parseAndValidateExcelBuffer.mockResolvedValue(validRows);

    const result = await ordersService.importExcel(Buffer.from('fake-excel'), 'user-1');

    expect(result.importedCount).toBe(2);
    expect(prismaService.order.create).toHaveBeenCalledTimes(2);
  });
});
