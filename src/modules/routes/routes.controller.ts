import { Controller, Post, Get, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { RoutesService } from './routes.service';
import { CreateRouteDto, GetRoutesQueryDto } from './routes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../users/users.constants';

@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async createRoute(@Body() dto: CreateRouteDto) {
    return this.routesService.createRoute(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async getRoutes(@Query() query: GetRoutesQueryDto) {
    return this.routesService.findAll(query);
  }

  @Get('mobile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_DRIVER)
  async getMobileRoutes(@Request() req: any) {
    return this.routesService.getMobileRoutes(req.user.driverId || req.user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async getRouteDetail(@Param('id') id: string) {
    return this.routesService.findOne(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async deleteRoute(@Param('id') id: string) {
    return this.routesService.deleteRoute(id);
  }

  @Post(':id/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_DRIVER, ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async completeRoute(@Param('id') id: string) {
    return this.routesService.completeRoute(id);
  }
}
