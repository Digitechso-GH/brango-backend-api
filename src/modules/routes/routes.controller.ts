import { Controller, Post, Get, Patch, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { RoutesService } from './routes.service';
import { CreateRouteDto, GetRoutesQueryDto, UpdateRouteDto } from './routes.dto';
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
  async getMobileRoutes(@Request() req: any, @Query('driverId') queryDriverId?: string) {
    const target = req.user.driverId || queryDriverId || req.user.sub;
    return this.routesService.getMobileRoutes(target);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async getRouteDetail(@Param('id') id: string) {
    return this.routesService.findOne(id);
  }

  @Patch(':id')
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async updateRoute(
    @Param('id') id: string,
    @Body() dto: UpdateRouteDto,
    @Request() req: any,
  ) {
    const actor = req.user?.name || req.user?.email || 'system';
    return this.routesService.updateRoute(id, dto, actor);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async cancelRoute(@Param('id') id: string, @Request() req: any) {
    const actor = req.user?.name || req.user?.email || 'system';
    return this.routesService.cancelRoute(id, actor);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async deleteRoute(@Param('id') id: string) {
    return this.routesService.deleteRoute(id);
  }

  // =========================================================================
  // [PROVISIONAL - PENDIENTE DE CONFIRMACIÓN DE NEGOCIO POR EL CLIENTE]
  // Endpoint: Forzar Cierre Administrativo de Ruta ante contingencias.
  // =========================================================================
  @Post(':id/force-close')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async forceCloseRoute(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    const actor = req.user?.name || req.user?.email || 'admin';
    return this.routesService.forceCloseRouteByAdmin(id, actor, reason);
  }

  @Post(':id/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_DRIVER, ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async completeRoute(@Param('id') id: string) {
    return this.routesService.completeRoute(id);
  }
}
