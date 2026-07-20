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
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
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
  async findAll() {
    return this.ordersService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
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
