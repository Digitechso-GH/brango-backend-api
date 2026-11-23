import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../users/users.constants';

@Controller('drivers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SYS_ADMIN, ROLES.SYS_COORDINATOR, ROLES.SYS_OPERATOR)
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  async create(@Body() dto: CreateDriverDto, @Req() req: any) {
    return this.driversService.create(dto, req.user?.tenantId);
  }

  @Get()
  async findAll(@Req() req: any) {
    return this.driversService.findAll(req.user?.tenantId);
  }

  @Get('available')
  async findAvailable(
    @Query('date') date: string | undefined,
    @Query('excludeRouteId') excludeRouteId: string | undefined,
    @Req() req: any,
  ) {
    return this.driversService.findAvailable(date, req.user?.tenantId, excludeRouteId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.driversService.findOne(id, req.user?.tenantId);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverDto,
    @Req() req: any,
  ) {
    return this.driversService.update(id, dto, req.user?.tenantId);
  }

  @Delete(':id')
  async delete(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.driversService.delete(id, req.user?.tenantId);
    return { message: 'Chofer eliminado correctamente' };
  }
}
