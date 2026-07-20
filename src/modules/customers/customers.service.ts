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
    const existing = await this.prisma.empresa.findUnique({
      where: { ruc: dto.ruc },
    });
    if (existing) {
      throw new BadRequestException(
        'Ya existe una empresa registrada con ese RUC',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.empresa.create({
        data: {
          nombre: dto.nombre,
          ruc: dto.ruc,
        },
      });

      // Crear automáticamente el cliente/sucursal de entrega principal
      await tx.cliente.create({
        data: {
          nombre: `${dto.nombre} - Matriz`,
          empresaId: company.id,
        },
      });

      return company;
    });
  }

  async createClient(dto: CreateClientDto) {
    const company = await this.prisma.empresa.findUnique({
      where: { id: dto.empresaId },
    });
    if (!company) {
      throw new NotFoundException('La empresa asociada no existe');
    }

    return this.prisma.cliente.create({
      data: {
        nombre: dto.nombre,
        empresaId: dto.empresaId,
      },
      include: { empresa: true },
    });
  }

  async findAllCompanies() {
    return this.prisma.empresa.findMany({
      include: { clientes: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async findAllClients() {
    return this.prisma.cliente.findMany({
      include: { empresa: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async findClientById(id: string) {
    const client = await this.prisma.cliente.findUnique({
      where: { id },
      include: { empresa: true },
    });
    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }
    return client;
  }

  async deleteCompany(id: string) {
    const company = await this.prisma.empresa.findUnique({
      where: { id },
      include: {
        clientes: {
          include: { pedidos: true },
        },
      },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const hasOrders = company.clientes.some((c) => c.pedidos.length > 0);
    if (hasOrders) {
      throw new BadRequestException(
        'No se puede eliminar la empresa porque tiene pedidos asociados en sus sucursales.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.cliente.deleteMany({
        where: { empresaId: id },
      });
      return tx.empresa.delete({
        where: { id },
      });
    });
  }

  async updateCompany(id: string, dto: CreateCompanyDto) {
    const company = await this.prisma.empresa.findUnique({
      where: { id },
    });
    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    // Si cambia el RUC, verificar que no exista duplicado
    if (dto.ruc !== company.ruc) {
      const existing = await this.prisma.empresa.findUnique({
        where: { ruc: dto.ruc },
      });
      if (existing) {
        throw new BadRequestException(
          'Ya existe otra empresa registrada con ese RUC',
        );
      }
    }

    return this.prisma.empresa.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        ruc: dto.ruc,
      },
    });
  }

  async deleteClient(id: string) {
    const client = await this.prisma.cliente.findUnique({
      where: { id },
      include: { pedidos: true },
    });
    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    if (client.pedidos.length > 0) {
      throw new BadRequestException(
        'No se puede eliminar el cliente porque tiene pedidos históricos asociados.',
      );
    }

    return this.prisma.cliente.delete({ where: { id } });
  }
}
