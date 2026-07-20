import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Headers,
  Query,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(
    @Body() dto: CreateOrderDto,
    @Headers('x-user-id') creatorId: string,
  ) {
    const userId = creatorId || 'SYS-ADMIN-ID';
    return this.ordersService.create(dto, userId);
  }

  @Get()
  async findAll(@Query('driverId') driverId?: string) {
    return this.ordersService.findAll(driverId);
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto);
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
    const userId = operatorId || creatorId || 'SYS-ADMIN-ID';
    return this.ordersService.importExcel(file.buffer, userId);
  }
}
