import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersClientResolverService } from './orders-client-resolver.service';
import { TrackingGateway } from '../../tracking/tracking.gateway';
import { ParsedExcelRow } from './orders-excel-parser.service';
import { GeocodingStatus, Prisma } from '@prisma/client';

@Injectable()
export class OrdersImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientResolverService: OrdersClientResolverService,
    private readonly trackingGateway: TrackingGateway,
  ) {}

  async executeAtomicImport(
    validRows: ParsedExcelRow[],
    operatorId: string,
  ): Promise<{ importedCount: number; orders: any[]; message: string }> {
    const clientMap = new Map<string, string | null>();
    for (const item of validRows) {
      const cacheKey = `${item.recipientCustomerType}_${item.recipientDocument}_${item.recipientName || ''}_${item.companyName || ''}`;
      if (!clientMap.has(cacheKey)) {
        const customerId = await this.clientResolverService.resolveOrCreateClient({
          recipientCustomerType: item.recipientCustomerType,
          recipientDocument: item.recipientDocument,
          recipientName: item.recipientName,
          companyName: item.companyName,
          companyRuc: item.companyRuc,
        });
        clientMap.set(cacheKey, customerId);
      }
    }

    const createdOrders = await this.prisma.$transaction(
      async (txPrisma: Prisma.TransactionClient) => {
        const resultOrders = [];

        for (const item of validRows) {
          const cacheKey = `${item.recipientCustomerType}_${item.recipientDocument}_${item.recipientName || ''}_${item.companyName || ''}`;
          const resolvedCustomerId = clientMap.get(cacheKey) || null;

          try {
            const order = await txPrisma.order.create({
              data: {
                code: item.code,
                waybill: item.waybill,
                recipientCustomerType: item.recipientCustomerType,
                recipientDocument: item.recipientDocument,
                recipientName: item.recipientName,
                recipientPhone: item.recipientPhone,
                rawAddress: item.rawAddress,
                formattedAddress: item.formattedAddress,
                latitude: item.latitude,
                longitude: item.longitude,
                geocodingStatus: item.geocodingStatus as GeocodingStatus,
                customerId: resolvedCustomerId,
                warehouseContact: item.warehouseContact,
              },
            });

            resultOrders.push(order);
          } catch (err: any) {
            throw new BadRequestException(
              `Error al crear el pedido en la fila ${item.rowNumber} (código "${item.code}"): ${err.message}`,
            );
          }
        }

        return resultOrders;
      },
      { timeout: 30000 },
    );

    return {
      importedCount: createdOrders.length,
      orders: createdOrders,
      message: `Se importaron ${createdOrders.length} pedidos correctamente`,
    };
  }
}
