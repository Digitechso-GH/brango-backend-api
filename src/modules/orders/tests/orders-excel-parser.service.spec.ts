import { Test, TestingModule } from '@nestjs/testing';
import { OrdersExcelParserService } from '../services/orders-excel-parser.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GeocodingService } from '../services/geocoding.service';
import { BadRequestException } from '@nestjs/common';
import * as xlsx from 'xlsx';

describe('OrdersExcelParserService', () => {
  let service: OrdersExcelParserService;
  let prismaService: any;
  let geocodingService: any;

  beforeEach(async () => {
    prismaService = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    geocodingService = {
      resolveBulkGeocoding: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersExcelParserService,
        { provide: PrismaService, useValue: prismaService },
        { provide: GeocodingService, useValue: geocodingService },
      ],
    }).compile();

    service = module.get<OrdersExcelParserService>(OrdersExcelParserService);
  });

  it('should throw BadRequestException if Excel is empty', async () => {
    const emptyWorkbook = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet([]);
    xlsx.utils.book_append_sheet(emptyWorkbook, ws, 'Orders');
    const buffer = xlsx.write(emptyWorkbook, { type: 'buffer', bookType: 'xlsx' });

    await expect(service.parseAndValidateExcelBuffer(buffer)).rejects.toThrow(BadRequestException);
  });

  it('should throw structured BadRequestException if internal duplicate or DB duplicate codes exist in single pass', async () => {
    const rows = [
      { 'Nº Pedido': 'PED-100', Cliente: 'Juan', Dirección: 'Av. Argentina' },
      { 'Nº Pedido': 'PED-100', Cliente: 'Pedro', Dirección: 'Jr. Luna' }, // Duplicado interno
      { 'Nº Pedido': 'PED-200', Cliente: 'Maria', Dirección: 'Av. Grau' },
    ];

    prismaService.order.findMany.mockResolvedValue([{ code: 'PED-200' }]); // Duplicado en DB

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    try {
      await service.parseAndValidateExcelBuffer(buffer);
      fail('Debería haber lanzado BadRequestException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      const resp = err.getResponse() as any;
      expect(resp.errors).toBeDefined();
      expect(resp.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});
