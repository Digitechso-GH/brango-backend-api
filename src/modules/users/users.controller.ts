import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from './users.constants';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SYS_ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }
    return this.usersService.findByTenant(tenantId);
  }

  @Post()
  create(
    @Req() req: any,
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      roleCode: string;
      phone?: string;
      unit?: string;
    },
  ) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }
    if (!body?.name || !body?.email || !body?.password || !body?.roleCode) {
      throw new BadRequestException('Faltan campos obligatorios (name, email, password, roleCode)');
    }
    return this.usersService.createForTenant(tenantId, body);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      roleCode?: string;
      active?: boolean;
      password?: string;
    },
  ) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Usuario sin empresa asignada');
    }
    return this.usersService.updateForTenant(tenantId, id, req.user.sub, body);
  }
}
