import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { getLimaDayRange } from '../../core/utils/date.util';
import { VehicleType } from '@prisma/client';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId?: string) {
    return this.prisma.vehicle.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { plate: 'asc' },
    });
  }

  async findAvailable(dateStr?: string, tenantId?: string, excludeRouteId?: string) {
    const { startOfDay, endOfDay } = getLimaDayRange(dateStr);

    return this.prisma.vehicle.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        active: true,
        routes: {
          none: {
            ...(excludeRouteId ? { id: { not: excludeRouteId } } : {}),
            date: {
              gte: startOfDay,
              lte: endOfDay,
            },
            status: {
              in: ['PENDING', 'IN_PROGRESS'],
            },
          },
        },
      },
      orderBy: { plate: 'asc' },
    });
  }

  async findOne(id: string, tenantId?: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!vehicle) {
      throw new NotFoundException('Vehículo no encontrado');
    }
    return vehicle;
  }

  async create(dto: CreateVehicleDto, tenantId?: string) {
    const cleanPlate = dto.plate.trim().toUpperCase();
    const existing = await this.prisma.vehicle.findFirst({
      where: {
        plate: cleanPlate,
        ...(tenantId ? { tenantId } : { tenantId: null }),
      },
    });
    if (existing) {
      throw new BadRequestException(`Ya existe un vehículo registrado con la placa ${cleanPlate}`);
    }

    return this.prisma.vehicle.create({
      data: {
        plate: cleanPlate,
        brand: dto.brand?.trim() || null,
        model: dto.model?.trim() || null,
        axles: dto.axles ?? null,
        capacityKg: dto.capacityKg ?? null,
        capacityM3: dto.capacityM3 ?? null,
        vehicleType: dto.vehicleType || VehicleType.CAMION,
        active: dto.active ?? true,
        ...(tenantId ? { tenantId } : {}),
      },
    });
  }

  async update(id: string, dto: UpdateVehicleDto, tenantId?: string) {
    const vehicle = await this.findOne(id, tenantId);

    let cleanPlate: string | undefined;
    if (dto.plate !== undefined) {
      cleanPlate = dto.plate.trim().toUpperCase();
      if (!cleanPlate) {
        throw new BadRequestException('La placa no puede estar vacía');
      }
      if (cleanPlate !== vehicle.plate) {
        const existing = await this.prisma.vehicle.findFirst({
          where: {
            plate: cleanPlate,
            id: { not: id },
            ...(tenantId ? { tenantId } : { tenantId: null }),
          },
        });
        if (existing) {
          throw new BadRequestException(`Ya existe otro vehículo con la placa ${cleanPlate}`);
        }
      }
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(cleanPlate !== undefined ? { plate: cleanPlate } : {}),
        ...(dto.brand !== undefined ? { brand: dto.brand?.trim() || null } : {}),
        ...(dto.model !== undefined ? { model: dto.model?.trim() || null } : {}),
        ...(dto.axles !== undefined ? { axles: dto.axles } : {}),
        ...(dto.capacityKg !== undefined ? { capacityKg: dto.capacityKg } : {}),
        ...(dto.capacityM3 !== undefined ? { capacityM3: dto.capacityM3 } : {}),
        ...(dto.vehicleType !== undefined ? { vehicleType: dto.vehicleType } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }
}
