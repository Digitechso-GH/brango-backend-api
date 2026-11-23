import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { getLimaDayRange } from '../../core/utils/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDriverDto, tenantId?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('El correo electrónico ya está registrado');
    }

    const driverRole = await this.prisma.role.findUnique({
      where: { code: 'SYS_DRIVER' },
    });
    if (!driverRole) {
      throw new BadRequestException(
        'El rol de chofer (SYS_DRIVER) no está sembrado en el sistema',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          password: hashedPassword,
          roleId: driverRole.id,
          active: dto.active ?? true,
          ...(tenantId ? { tenantId } : {}),
        },
      });

      const profile = await tx.driverProfile.create({
        data: {
          userId: user.id,
          phone: dto.phone || null,
          licenseNumber: dto.licenseNumber?.trim() || null,
          licenseCategory: dto.licenseCategory || null,
          active: dto.active ?? true,
          ...(tenantId ? { tenantId } : {}),
        },
        include: { user: true },
      });

      return profile;
    });
  }

  async update(id: string, dto: UpdateDriverDto, tenantId?: string) {
    const profile = await this.prisma.driverProfile.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { user: true },
    });
    if (!profile) {
      throw new NotFoundException('Chofer no encontrado');
    }

    if (dto.email && dto.email !== profile.user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existing) {
        throw new BadRequestException(
          'El correo electrónico ya está registrado por otro usuario',
        );
      }
    }

    const userUpdateData: any = {};
    if (dto.name) userUpdateData.name = dto.name;
    if (dto.email) userUpdateData.email = dto.email;
    if (dto.active !== undefined) userUpdateData.active = dto.active;
    if (dto.password) {
      userUpdateData.password = await bcrypt.hash(dto.password, 10);
    }

    const profileUpdateData: any = {};
    if (dto.phone !== undefined) profileUpdateData.phone = dto.phone;
    if (dto.licenseNumber !== undefined) profileUpdateData.licenseNumber = dto.licenseNumber?.trim() || null;
    if (dto.licenseCategory !== undefined) profileUpdateData.licenseCategory = dto.licenseCategory;
    if (dto.active !== undefined) profileUpdateData.active = dto.active;

    return this.prisma.$transaction(async (tx) => {
      if (Object.keys(userUpdateData).length > 0) {
        await tx.user.update({
          where: { id: profile.userId },
          data: userUpdateData,
        });
      }

      const updatedProfile = await tx.driverProfile.update({
        where: { id },
        data: profileUpdateData,
        include: { user: true },
      });

      return updatedProfile;
    });
  }

  async findAll(tenantId?: string) {
    return this.prisma.driverProfile.findMany({
      where: tenantId ? { tenantId } : undefined,
      include: { user: true },
      orderBy: { user: { name: 'asc' } },
    });
  }

  async findAvailable(dateStr?: string, tenantId?: string, excludeRouteId?: string) {
    const { startOfDay, endOfDay } = getLimaDayRange(dateStr);

    return this.prisma.driverProfile.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        active: true,
        user: { active: true },
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
      include: { user: true },
      orderBy: { user: { name: 'asc' } },
    });
  }

  async findOne(id: string, tenantId?: string) {
    const profile = await this.prisma.driverProfile.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { user: true },
    });
    if (!profile) {
      throw new NotFoundException('Chofer no encontrado');
    }
    return profile;
  }

  async delete(id: string, tenantId?: string) {
    const profile = await this.prisma.driverProfile.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { assignments: true },
    });
    if (!profile) {
      throw new NotFoundException('Chofer no encontrado');
    }

    if (profile.assignments.length > 0) {
      throw new BadRequestException(
        'No se puede eliminar al chofer porque tiene pedidos asignados.',
      );
    }

    return this.prisma.user.delete({
      where: { id: profile.userId },
    });
  }
}
