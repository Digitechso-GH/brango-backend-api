import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { SedesService } from './sedes.service';
import { CreateSedeDto } from './dto/create-sede.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../users/users.constants';

@Controller('sedes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SYS_ADMIN, ROLES.SYS_COORDINATOR, ROLES.SYS_OPERATOR)
export class SedesController {
  constructor(private readonly sedesService: SedesService) {}

  @Get()
  async findAll(@Req() req: any) {
    return this.sedesService.findAll(req.user?.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateSedeDto, @Req() req: any) {
    return this.sedesService.create(dto, req.user?.tenantId);
  }
}
