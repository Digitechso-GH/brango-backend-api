import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RecipientCustomerType, Prisma } from '@prisma/client';

export interface ResolveClientParams {
  recipientCustomerType: RecipientCustomerType;
  recipientDocument?: string | null;
  recipientName?: string | null;
  companyName?: string | null;
  companyRuc?: string | null;
  customerId?: string | null;
}

@Injectable()
export class OrdersClientResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveOrCreateClient(
    params: ResolveClientParams,
    txPrisma?: Prisma.TransactionClient,
  ): Promise<string | null> {
    const db = txPrisma || this.prisma;

    if (params.customerId) {
      const existingCustomer = await db.customer.findUnique({
        where: { id: params.customerId },
      });
      if (existingCustomer) return existingCustomer.id;
    }

    const cleanRuc = (params.companyRuc || params.recipientDocument || '').trim();
    const cleanName = (params.companyName || params.recipientName || '').trim();

    if (cleanRuc || cleanName) {
      let company = cleanRuc
        ? await db.company.findUnique({
            where: { ruc: cleanRuc },
            include: { customers: true },
          })
        : await db.company.findFirst({
            where: { name: { equals: cleanName, mode: 'insensitive' } },
            include: { customers: true },
          });

      if (!company) {
        const finalRuc = cleanRuc || cleanName;
        company = await db.company.create({
          data: {
            name: cleanName || cleanRuc,
            ruc: finalRuc,
          },
          include: { customers: true },
        });
      }

      let customer = company.customers?.[0];
      if (!customer) {
        customer = await db.customer.create({
          data: {
            name: cleanName || company.name,
            companyId: company.id,
          },
        });
      }

      return customer.id;
    }

    return null;
  }
}
