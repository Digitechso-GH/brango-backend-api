import { Test, TestingModule } from '@nestjs/testing';
import { OrdersClientResolverService } from '../services/orders-client-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RecipientCustomerType } from '@prisma/client';

describe('OrdersClientResolverService', () => {
  let service: OrdersClientResolverService;
  let prismaService: any;

  beforeEach(async () => {
    prismaService = {
      customer: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      company: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersClientResolverService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<OrdersClientResolverService>(OrdersClientResolverService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return customerId if explicit customerId is passed and exists', async () => {
    prismaService.customer.findUnique.mockResolvedValue({ id: 'client-123' });

    const res = await service.resolveOrCreateClient({
      recipientCustomerType: RecipientCustomerType.INDIVIDUAL,
      customerId: 'client-123',
    });

    expect(res).toBe('client-123');
    expect(prismaService.customer.findUnique).toHaveBeenCalledWith({ where: { id: 'client-123' } });
  });

  it('should create company and customer for COMPANY type when not found', async () => {
    prismaService.company.findUnique.mockResolvedValue(null);
    prismaService.company.create.mockResolvedValue({ id: 'emp-1', name: 'Test SAC', customers: [] });
    prismaService.customer.create.mockResolvedValue({ id: 'cli-1', name: 'Test SAC' });

    const res = await service.resolveOrCreateClient({
      recipientCustomerType: RecipientCustomerType.COMPANY,
      companyRuc: '20600000001',
      companyName: 'Test SAC',
    });

    expect(res).toBe('cli-1');
    expect(prismaService.company.create).toHaveBeenCalled();
  });
});
