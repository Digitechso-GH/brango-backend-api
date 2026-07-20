import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedRoles();
    await this.seedUsers();
  }

  private async seedRoles() {
    const roles = [
      { code: 'SYS_ADMIN', nombre: 'Administrador del Sistema' },
      { code: 'SYS_OPERATOR', nombre: 'Operador de Logística' },
      { code: 'SYS_DRIVER', nombre: 'Chofer / Transportista' },
    ];

    for (const role of roles) {
      await this.prisma.rol.upsert({
        where: { code: role.code },
        update: { nombre: role.nombre },
        create: {
          code: role.code,
          nombre: role.nombre,
        },
      });
    }
  }

  private async seedUsers() {
    const adminRole = await this.prisma.rol.findUnique({
      where: { code: 'SYS_ADMIN' },
    });
    if (!adminRole) return;

    const count = await this.prisma.usuario.count();
    if (count === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await this.prisma.usuario.create({
        data: {
          email: 'admin@brango.com',
          nombre: 'Administrador Semilla',
          password: hashedPassword,
          rolId: adminRole.id,
        },
      });
    }
  }

  async findByEmail(email: string) {
    return this.prisma.usuario.findUnique({
      where: { email },
      include: { rol: true },
    });
  }

  async findById(id: string) {
    return this.prisma.usuario.findUnique({
      where: { id },
      include: { rol: true, chofer: true },
    });
  }

  async getRoleByCode(code: string) {
    return this.prisma.rol.findUnique({
      where: { code },
    });
  }
}
