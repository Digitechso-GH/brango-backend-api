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
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ReorderAssignmentsDto } from './dto/reorder-assignments.dto';
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
  async getPresignedUrl(@Body('key') key?: string) {
    const finalKey = key || `evidence-${Date.now()}.jpg`;
    const uploadUrl = await this.storageService.getUploadUrl(finalKey);
    const publicUrl = this.storageService.getPublicUrl(finalKey);
    return { uploadUrl, publicUrl, key: finalKey };
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
    @Query('driverId') driverId?: string,
    @Query('todayOnly') todayOnly?: string,
    @Query('date') date?: string,
  ) {
    return this.ordersService.findAll(driverId, todayOnly, date);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.ordersService.update(id, dto);
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
}
