import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { CreateClientDto } from './dto/create-client.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async createCompany(dto: CreateCompanyDto) {
    const existing = await this.prisma.company.findUnique({
      where: { ruc: dto.ruc },
    });
    if (existing) {
      throw new BadRequestException(
        'Ya existe una empresa registrada con ese RUC',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: dto.name,
          ruc: dto.ruc,
        },
      });

      // Crear automáticamente el cliente/sucursal de entrega principal
      await tx.customer.create({
        data: {
          name: dto.name,
          companyId: company.id,
        },
      });

      return company;
    });
  }

  async createClient(dto: CreateClientDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });
    if (!company) {
      throw new NotFoundException('La empresa asociada no existe');
    }

    return this.prisma.customer.create({
      data: {
        name: dto.name,
        companyId: dto.companyId,
      },
      include: { company: true },
    });
  }

  async findAllCompanies() {
    return this.prisma.company.findMany({
      include: { customers: true },
      orderBy: { name: 'asc' },
    });
  }

  async findAllClients() {
    return this.prisma.customer.findMany({
      include: { company: true },
      orderBy: { name: 'asc' },
    });
  }

  async findClientById(id: string) {
    const client = await this.prisma.customer.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }
    return client;
  }

  async deleteCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        customers: {
          include: { orders: true },
        },
      },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const hasOrders = company.customers.some((c: any) => c.orders.length > 0);
    if (hasOrders) {
      throw new BadRequestException(
        'No se puede eliminar la empresa porque tiene pedidos asociados en sus sucursales.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customer.deleteMany({
        where: { companyId: id },
      });
      return tx.company.delete({
        where: { id },
      });
    });
  }

  async updateCompany(id: string, dto: CreateCompanyDto) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    // Si cambia el RUC, verificar que no exista duplicado
    if (dto.ruc !== company.ruc) {
      const existing = await this.prisma.company.findUnique({
        where: { ruc: dto.ruc },
      });
      if (existing) {
        throw new BadRequestException(
          'Ya existe otra empresa registrada con ese RUC',
        );
      }
    }

    return this.prisma.company.update({
      where: { id },
      data: {
        name: dto.name,
        ruc: dto.ruc,
      },
    });
  }

  async deleteClient(id: string) {
    const client = await this.prisma.customer.findUnique({
      where: { id },
      include: { orders: true },
    });
    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    if (client.orders.length > 0) {
      throw new BadRequestException(
        'No se puede eliminar el cliente porque tiene pedidos históricos asociados.',
      );
    }

    return this.prisma.customer.delete({ where: { id } });
  }
}
