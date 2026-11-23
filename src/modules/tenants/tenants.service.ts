import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanTier, TenantStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLES } from '../users/users.constants';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.tenant.findMany({
      include: {
        _count: {
          select: { users: true, orders: true, routes: true, drivers: true },
        },
        users: {
          where: { role: { code: ROLES.SYS_ADMIN } },
          select: { id: true, name: true, email: true, active: true },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: {
    name: string;
    tradeName?: string;
    ruc: string;
    planTier?: PlanTier;
    managerName: string;
    managerEmail: string;
    managerPassword: string;
  }) {
    const cleanRuc = dto.ruc.trim();
    const cleanEmail = dto.managerEmail.toLowerCase().trim();

    const [existingTenant, existingUser, managerRole] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { ruc: cleanRuc } }),
      this.prisma.user.findUnique({ where: { email: cleanEmail } }),
      this.prisma.role.findUnique({ where: { code: ROLES.SYS_ADMIN } }),
    ]);

    if (existingTenant) {
      throw new BadRequestException(`Ya existe una empresa registrada con el RUC ${cleanRuc}`);
    }
    if (existingUser) {
      throw new BadRequestException(`El correo ${cleanEmail} ya está en uso por otro usuario`);
    }
    if (!managerRole) {
      throw new BadRequestException('Rol de Gerente (SYS_ADMIN) no encontrado');
    }

    const hashedPassword = await bcrypt.hash(dto.managerPassword.trim(), 10);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name.trim(),
          tradeName: dto.tradeName?.trim() || null,
          ruc: cleanRuc,
          planTier: dto.planTier || PlanTier.PLAN_1,
          status: TenantStatus.ACTIVE,
        },
      });

      const manager = await tx.user.create({
        data: {
          name: dto.managerName.trim(),
          email: cleanEmail,
          password: hashedPassword,
          roleId: managerRole.id,
          tenantId: tenant.id,
          active: true,
        },
        select: { id: true, name: true, email: true, active: true },
      });

      return { tenant, manager };
    });
  }

  async update(
    id: string,
    dto: {
      name?: string;
      tradeName?: string;
      ruc?: string;
      planTier?: PlanTier;
      status?: TenantStatus;
      managerId?: string;
      managerEmail?: string;
    },
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('Empresa no encontrada');
    }

    let cleanRuc: string | undefined;
    if (dto.ruc !== undefined) {
      cleanRuc = dto.ruc.trim();
      if (!cleanRuc) {
        throw new BadRequestException('El RUC no puede estar vacío');
      }
      if (cleanRuc !== tenant.ruc) {
        const existingRuc = await this.prisma.tenant.findFirst({
          where: { ruc: cleanRuc, id: { not: id } },
        });
        if (existingRuc) {
          throw new BadRequestException(`Ya existe otra empresa registrada con el RUC ${cleanRuc}`);
        }
      }
    }

    let targetManagerId: string | undefined;
    let cleanManagerEmail: string | undefined;

    if (dto.managerEmail !== undefined) {
      cleanManagerEmail = dto.managerEmail.toLowerCase().trim();
      if (!cleanManagerEmail) {
        throw new BadRequestException('El correo no puede estar vacío');
      }

      const targetManager = dto.managerId
        ? await this.prisma.user.findFirst({
            where: { id: dto.managerId, tenantId: id },
          })
        : await this.prisma.user.findFirst({
            where: { tenantId: id, role: { code: ROLES.SYS_ADMIN } },
            orderBy: { createdAt: 'asc' },
          });

      if (!targetManager) {
        throw new NotFoundException('Gerente de la empresa no encontrado');
      }

      if (cleanManagerEmail !== targetManager.email) {
        const existingEmail = await this.prisma.user.findUnique({
          where: { email: cleanManagerEmail },
        });
        if (existingEmail && existingEmail.id !== targetManager.id) {
          throw new BadRequestException(`El correo ${cleanManagerEmail} ya está en uso por otro usuario`);
        }
        targetManagerId = targetManager.id;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedTenant = await tx.tenant.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.tradeName !== undefined ? { tradeName: dto.tradeName?.trim() || null } : {}),
          ...(cleanRuc !== undefined ? { ruc: cleanRuc } : {}),
          ...(dto.planTier !== undefined ? { planTier: dto.planTier } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });

      if (targetManagerId && cleanManagerEmail) {
        await tx.user.update({
          where: { id: targetManagerId },
          data: { email: cleanManagerEmail },
        });
      }

      return updatedTenant;
    });
  }

  async createManager(
    tenantId: string,
    dto: { name: string; email: string; password: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Empresa no encontrada');
    }

    const cleanEmail = dto.email.toLowerCase().trim();
    const existingUser = await this.prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      throw new BadRequestException(`El correo ${cleanEmail} ya está en uso`);
    }

    const managerRole = await this.prisma.role.findUnique({ where: { code: ROLES.SYS_ADMIN } });
    if (!managerRole) {
      throw new BadRequestException('Rol SYS_ADMIN no encontrado');
    }

    const hashedPassword = await bcrypt.hash(dto.password.trim(), 10);
    return this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        email: cleanEmail,
        password: hashedPassword,
        roleId: managerRole.id,
        tenantId,
        active: true,
      },
      select: { id: true, name: true, email: true, active: true, createdAt: true },
    });
  }

  async findAllUsers(tenantId?: string) {
    return this.prisma.user.findMany({
      where: {
        role: { code: { not: ROLES.SYS_SUPERADMIN } },
        ...(tenantId ? { tenantId } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        createdAt: true,
        role: { select: { id: true, code: true, name: true } },
        tenant: { select: { id: true, name: true, tradeName: true, ruc: true, status: true } },
      },
      orderBy: [{ tenant: { name: 'asc' } }, { createdAt: 'desc' }],
    });
  }
}
