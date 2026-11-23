import { Injectable, OnModuleInit, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { ROLES } from './users.constants';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedRoles();
    await this.ensureInitialTenantAndBackfill();
    await this.seedUsers();
  }

  private async seedRoles() {
    const roles = [
      { code: ROLES.SYS_SUPERADMIN, name: 'Super Administrador' },
      { code: ROLES.SYS_ADMIN, name: 'Gerente de Empresa' },
      { code: ROLES.SYS_COORDINATOR, name: 'Coordinador Logístico' },
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

  private async ensureInitialTenantAndBackfill() {
    const defaultTenant = await this.prisma.tenant.upsert({
      where: { ruc: '20603105029' },
      update: {},
      create: {
        id: '00000000-0000-4000-a000-000000000001',
        name: 'COMERCIAL AQUAMUNDO PERU S.A.C.',
        tradeName: 'Aquamundo',
        ruc: '20603105029',
        planTier: 'PLAN_1',
        status: 'ACTIVE',
      },
    });

    const tenantId = defaultTenant.id;
    const superAdminRole = await this.prisma.role.findUnique({ where: { code: ROLES.SYS_SUPERADMIN } });

    await Promise.all([
      this.prisma.user.updateMany({
        where: {
          tenantId: null,
          ...(superAdminRole ? { roleId: { not: superAdminRole.id } } : {}),
        },
        data: { tenantId },
      }),
      this.prisma.driverProfile.updateMany({ where: { tenantId: null }, data: { tenantId } }),
      this.prisma.company.updateMany({ where: { tenantId: null }, data: { tenantId } }),
      this.prisma.customer.updateMany({ where: { tenantId: null }, data: { tenantId } }),
      this.prisma.branch.updateMany({ where: { tenantId: null }, data: { tenantId } }),
      this.prisma.order.updateMany({ where: { tenantId: null }, data: { tenantId } }),
      this.prisma.route.updateMany({ where: { tenantId: null }, data: { tenantId } }),
      this.prisma.vehicle.updateMany({ where: { tenantId: null }, data: { tenantId } }),
    ]);
  }

  private async seedUsers() {
    const [superAdminRole, adminRole, defaultTenant] = await Promise.all([
      this.prisma.role.findUnique({ where: { code: ROLES.SYS_SUPERADMIN } }),
      this.prisma.role.findUnique({ where: { code: ROLES.SYS_ADMIN } }),
      this.prisma.tenant.findUnique({ where: { ruc: '20603105029' } }),
    ]);

    if (superAdminRole) {
      const superAdminExists = await this.prisma.user.findFirst({
        where: { roleId: superAdminRole.id },
      });
      if (!superAdminExists) {
        const superEmail = process.env.SUPERADMIN_SEED_EMAIL || 'superadmin@brango.com';
        const superPassword = process.env.SUPERADMIN_SEED_PASSWORD || 'admin123';
        const hashedSuperPassword = await bcrypt.hash(superPassword, 10);
        await this.prisma.user.upsert({
          where: { email: superEmail },
          update: { roleId: superAdminRole.id, tenantId: null },
          create: {
            email: superEmail,
            name: 'Super Administrador BranGo',
            password: hashedSuperPassword,
            roleId: superAdminRole.id,
            tenantId: null,
          },
        });
      }
    }

    if (adminRole && defaultTenant) {
      const anyTenantUser = await this.prisma.user.count({ where: { tenantId: defaultTenant.id } });
      if (anyTenantUser === 0) {
        const defaultEmail = process.env.ADMIN_SEED_EMAIL || 'admin@brango.com';
        const hashedPassword = await bcrypt.hash(process.env.ADMIN_SEED_PASSWORD || 'admin123', 10);
        await this.prisma.user.create({
          data: {
            email: defaultEmail,
            name: 'Gerente Aquamundo',
            password: hashedPassword,
            roleId: adminRole.id,
            tenantId: defaultTenant.id,
          },
        });
      }
    }
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { role: true, tenant: true },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true, driver: true, tenant: true },
    });
  }

  async getRoleByCode(code: string) {
    return this.prisma.role.findUnique({
      where: { code },
    });
  }

  // Gestión de usuarios por Empresa (Gerente / SYS_ADMIN)
  async findByTenant(tenantId: string) {
    return this.prisma.user.findMany({
      where: {
        tenantId,
        role: { code: { not: ROLES.SYS_SUPERADMIN } },
      },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        createdAt: true,
        role: { select: { id: true, code: true, name: true } },
        driver: { select: { id: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createForTenant(
    tenantId: string,
    dto: { name: string; email: string; password: string; roleCode: string; phone?: string; unit?: string },
  ) {
    const allowedRoles: string[] = [ROLES.SYS_ADMIN, ROLES.SYS_COORDINATOR, ROLES.SYS_DRIVER];
    if (!allowedRoles.includes(dto.roleCode)) {
      throw new BadRequestException('Rol no permitido para usuarios de empresa');
    }

    const cleanEmail = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) {
      throw new BadRequestException('Ya existe un usuario registrado con ese correo');
    }

    const role = await this.getRoleByCode(dto.roleCode);
    if (!role) {
      throw new BadRequestException('Rol no encontrado');
    }

    const hashedPassword = await bcrypt.hash(dto.password.trim(), 10);

    return this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email: cleanEmail,
        password: hashedPassword,
        roleId: role.id,
        tenantId,
        ...(dto.roleCode === ROLES.SYS_DRIVER
          ? {
              driver: {
                create: {
                  tenantId,
                  phone: dto.phone?.trim() || null,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        createdAt: true,
        role: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async updateForTenant(
    tenantId: string,
    userId: string,
    currentUserId: string,
    dto: { name?: string; roleCode?: string; active?: boolean; password?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.tenantId !== tenantId) {
      throw new NotFoundException('Usuario no encontrado en esta empresa');
    }

    if (user.id === currentUserId && dto.active === false) {
      throw new ForbiddenException('No puedes desactivar tu propia cuenta');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.password && dto.password.trim().length > 0) {
      data.password = await bcrypt.hash(dto.password.trim(), 10);
    }

    if (dto.roleCode && dto.roleCode !== user.role.code) {
      const allowedRoles: string[] = [ROLES.SYS_ADMIN, ROLES.SYS_COORDINATOR, ROLES.SYS_DRIVER];
      if (!allowedRoles.includes(dto.roleCode)) {
        throw new BadRequestException('Rol no permitido');
      }
      const newRole = await this.getRoleByCode(dto.roleCode);
      if (!newRole) throw new BadRequestException('Rol no encontrado');
      data.roleId = newRole.id;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        createdAt: true,
        role: { select: { id: true, code: true, name: true } },
      },
    });
  }
}
