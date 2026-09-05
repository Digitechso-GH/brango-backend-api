import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Headers,
  Query,
  UseGuards,
  Request,
  Inject,
  Delete,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ReorderAssignmentsDto } from './dto/reorder-assignments.dto';
import { GroupStopsDto } from './dto/group-stops.dto';
import { UngroupStopDto } from './dto/ungroup-stop.dto';
import { GroupEvidenceDto } from './dto/group-evidence.dto';
import { PauseOrderDto } from './dto/pause-order.dto';
import { OrderPausesService } from './services/order-pauses.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../users/users.constants';
import { STORAGE_SERVICE_TOKEN } from '../storage/storage.service';
import type { StorageService } from '../storage/storage.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderPausesService: OrderPausesService,
    @Inject(STORAGE_SERVICE_TOKEN)
    private readonly storageService: StorageService,
  ) {}

  @Post()
  async create(
    @Body() dto: CreateOrderDto,
    @Headers('x-user-id') creatorId?: string,
  ) {
    return this.ordersService.create(dto, creatorId);
  }

  @Post('presigned-url')
  async getPresignedUrl(
    @Body('key') key?: string,
    @Body('contentType') contentType?: string,
  ) {
    const finalKey = key || `evidence-${Date.now()}.jpg`;
    const uploadUrl = await this.storageService.getUploadUrl(finalKey, contentType);
    const publicUrl = this.storageService.getPublicUrl(finalKey);
    return { uploadUrl, publicUrl, key: finalKey };
  }

  @Get('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR, ROLES.SYS_DRIVER)
  async getConfig() {
    return this.ordersService.getConfig();
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async updateConfig(@Body() config: Record<string, string>) {
    return this.ordersService.updateConfig(config);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importOrders(
    @UploadedFile() file: Express.Multer.File,
    @Body('operatorId') operatorId?: string,
    @Headers('x-user-id') creatorId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No se ha proporcionado ningún archivo');
    }
    const userId = operatorId || creatorId;
    return this.ordersService.importExcel(file.buffer, userId);
  }

  @Patch('reorder')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_DRIVER)
  async reorder(
    @Request() req: any,
    @Body() dto: ReorderAssignmentsDto,
  ) {
    const userId = req.user.sub;
    return this.ordersService.reorderAssignments(userId, dto);
  }

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('driverId') driverId?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 20;
    return this.ordersService.findAll(search, pageNumber, limitNumber, driverId);
  }

  @Get('today')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR, ROLES.SYS_DRIVER)
  async findToday(@Request() req: any, @Query('driverId') driverId?: string) {
    // Si es chofer, forzamos su propio ID. Si es Admin/Dispatcher y envían driverId, filtramos por él. Si no, devolvemos todos.
    const isDriver = req.user.role === ROLES.SYS_DRIVER;
    const targetDriverId = isDriver ? req.user.sub : driverId;
    return this.ordersService.findToday(targetDriverId);
  }
  @Get('duplicates-suggestions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async getDuplicateSuggestions(@Query('date') date?: string) {
    return this.ordersService.getDuplicateStopSuggestions(date);
  }

  @Post('group-stops')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async groupStops(@Request() req: any, @Body() dto: GroupStopsDto) {
    const userId = req.user?.id || req.user?.sub;
    return this.ordersService.groupStops(dto, userId);
  }

  @Post('ungroup-stop')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async ungroupStop(@Request() req: any, @Body() dto: UngroupStopDto) {
    const userId = req.user?.id || req.user?.sub;
    return this.ordersService.ungroupStop(dto, userId);
  }

  @Post('group-evidence')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_DRIVER, ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async addGroupEvidence(@Body() dto: GroupEvidenceDto) {
    return this.ordersService.addGroupEvidence(dto);
  }

  @Get('paused')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async findPaused() {
    return this.orderPausesService.findPausedOrders();
  }

  @Patch(':id/pause')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async pauseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PauseOrderDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id || req.user?.sub;
    return this.orderPausesService.pauseOrder(id, dto, userId);
  }

  @Patch(':id/resume')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async resumeOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const userId = req.user?.id || req.user?.sub;
    return this.orderPausesService.resumeOrder(id, userId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto) {
    console.log('UpdateOrderDto received:', updateOrderDto);
    return this.ordersService.update(id, updateOrderDto);
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) routeAssignmentId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(routeAssignmentId, dto);
  }

  @Post(':id/evidence')
  async addEvidence(
    @Param('id', ParseUUIDPipe) routeAssignmentId: string,
    @Body('s3Url') s3Url: string,
    @Body('signatureText') signatureText?: string,
  ) {
    return this.ordersService.addEvidence(routeAssignmentId, s3Url, signatureText);
  }

  @Post(':id/reassign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN, ROLES.SYS_OPERATOR)
  async reassign(
    @Param('id', ParseUUIDPipe) previousAssignmentId: string,
    @Body() dto: { driverId: string; vehicleId?: string; date: string },
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    return this.ordersService.reassignAssignment(previousAssignmentId, dto, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.SYS_ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.remove(id);
  }
}
