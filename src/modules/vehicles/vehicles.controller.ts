import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../users/users.constants';

@Controller('vehicles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SYS_ADMIN, ROLES.SYS_COORDINATOR, ROLES.SYS_OPERATOR)
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get()
  async findAll(@Req() req: any) {
    return this.vehiclesService.findAll(req.user?.tenantId);
  }

  @Get('available')
  async findAvailable(
    @Query('date') date: string | undefined,
    @Query('excludeRouteId') excludeRouteId: string | undefined,
    @Req() req: any,
  ) {
    return this.vehiclesService.findAvailable(date, req.user?.tenantId, excludeRouteId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.vehiclesService.findOne(id, req.user?.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateVehicleDto, @Req() req: any) {
    return this.vehiclesService.create(dto, req.user?.tenantId);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
    @Req() req: any,
  ) {
    return this.vehiclesService.update(id, dto, req.user?.tenantId);
  }

  @Patch(':id/status')
  async toggleStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('active') active: boolean,
    @Req() req: any,
  ) {
    return this.vehiclesService.update(id, { active }, req.user?.tenantId);
  }
}
