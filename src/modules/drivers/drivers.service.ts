import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDriverDto) {
    const existing = await this.prisma.usuario.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new BadRequestException('El correo electrónico ya está registrado');
    }

    const driverRole = await this.prisma.rol.findUnique({
      where: { code: 'SYS_DRIVER' },
    });
    if (!driverRole) {
      throw new BadRequestException(
        'El rol de chofer (SYS_DRIVER) no está sembrado en el sistema',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.usuario.create({
        data: {
          email: dto.email,
          nombre: dto.nombre,
          password: hashedPassword,
          rolId: driverRole.id,
        },
      });

      const profile = await tx.driverProfile.create({
        data: {
          usuarioId: user.id,
          unidad: dto.unidad || null,
          telefono: dto.telefono || null,
        },
        include: { usuario: true },
      });

      return profile;
    });
  }

  async update(id: string, dto: UpdateDriverDto) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id },
      include: { usuario: true },
    });
    if (!profile) {
      throw new NotFoundException('Chofer no encontrado');
    }

    // Si edita el email, verificar unicidad
    if (dto.email && dto.email !== profile.usuario.email) {
      const existing = await this.prisma.usuario.findUnique({
        where: { email: dto.email },
      });
      if (existing) {
        throw new BadRequestException(
          'El correo electrónico ya está registrado por otro usuario',
        );
      }
    }

    const userUpdateData: any = {};
    if (dto.nombre) userUpdateData.nombre = dto.nombre;
    if (dto.email) userUpdateData.email = dto.email;
    if (dto.password) {
      userUpdateData.password = await bcrypt.hash(dto.password, 10);
    }

    const profileUpdateData: any = {};
    if (dto.unidad !== undefined) profileUpdateData.unidad = dto.unidad;
    if (dto.telefono !== undefined) profileUpdateData.telefono = dto.telefono;

    return this.prisma.$transaction(async (tx) => {
      if (Object.keys(userUpdateData).length > 0) {
        await tx.usuario.update({
          where: { id: profile.usuarioId },
          data: userUpdateData,
        });
      }

      const updatedProfile = await tx.driverProfile.update({
        where: { id },
        data: profileUpdateData,
        include: { usuario: true },
      });

      return updatedProfile;
    });
  }

  async findAll() {
    return this.prisma.driverProfile.findMany({
      include: { usuario: true },
      orderBy: { usuario: { nombre: 'asc' } },
    });
  }

  async findOne(id: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id },
      include: { usuario: true },
    });
    if (!profile) {
      throw new NotFoundException('Chofer no encontrado');
    }
    return profile;
  }

  async delete(id: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id },
      include: { pedidosAsignados: true },
    });
    if (!profile) {
      throw new NotFoundException('Chofer no encontrado');
    }

    // Verificar si tiene pedidos asignados activos/históricos
    if (profile.pedidosAsignados.length > 0) {
      throw new BadRequestException(
        'No se puede eliminar al chofer porque tiene pedidos asignados.',
      );
    }

    // Al eliminar el usuario, la relación en DriverProfile se elimina por Cascade
    return this.prisma.usuario.delete({
      where: { id: profile.usuarioId },
    });
  }
}
