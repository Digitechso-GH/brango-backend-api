import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { ROLES } from './users.constants';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedRoles();
    await this.seedUsers();
  }

  private async seedRoles() {
    const roles = [
      { code: ROLES.SYS_ADMIN, name: 'Administrador del Sistema' },
      { code: ROLES.SYS_OPERATOR, name: 'Operador de Logística' },
      { code: ROLES.SYS_DRIVER, name: 'Chofer / Transportista' },
    ];

    for (const role of roles) {
      await this.prisma.role.upsert({
        where: { code: role.code },
        update: { name: role.name },
        create: {
          code: role.code,
          name: role.name,
        },
      });
    }
  }

  private async seedUsers() {
    const adminRole = await this.prisma.role.findUnique({
      where: { code: ROLES.SYS_ADMIN },
    });
    if (!adminRole) return;

    const count = await this.prisma.user.count();
    if (count === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await this.prisma.user.create({
        data: {
          email: 'admin@brango.com',
          name: 'Administrador Semilla',
          password: hashedPassword,
          roleId: adminRole.id,
        },
      });
    }
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true, driver: true },
    });
  }

  async getRoleByCode(code: string) {
    return this.prisma.role.findUnique({
      where: { code },
    });
  }
}
