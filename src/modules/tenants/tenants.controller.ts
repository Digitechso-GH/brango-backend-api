import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../users/users.constants';
import { PlanTier, TenantStatus } from '@prisma/client';

@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SYS_SUPERADMIN)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  findAll() {
    return this.tenantsService.findAll();
  }

  @Get('users')
  findAllUsers(@Query('tenantId') tenantId?: string) {
    return this.tenantsService.findAllUsers(tenantId);
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      tradeName?: string;
      ruc: string;
      planTier?: PlanTier;
      managerName: string;
      managerEmail: string;
      managerPassword: string;
    },
  ) {
    if (!body?.name || !body?.ruc || !body?.managerName || !body?.managerEmail || !body?.managerPassword) {
      throw new BadRequestException('Faltan campos obligatorios para crear la empresa y su gerente');
    }
    return this.tenantsService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      tradeName?: string;
      ruc?: string;
      planTier?: PlanTier;
      status?: TenantStatus;
    },
  ) {
    return this.tenantsService.update(id, body);
  }

  @Post(':id/managers')
  createManager(
    @Param('id') id: string,
    @Body() body: { name: string; email: string; password: string },
  ) {
    if (!body?.name || !body?.email || !body?.password) {
      throw new BadRequestException('Faltan campos obligatorios (name, email, password)');
    }
    return this.tenantsService.createManager(id, body);
  }
}
