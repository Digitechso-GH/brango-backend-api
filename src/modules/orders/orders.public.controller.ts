import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('public/tracking')
export class OrdersPublicController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':token')
  async getTracking(@Param('token') token: string) {
    if (!token || !token.trim()) {
      throw new NotFoundException('Token de seguimiento inválido');
    }
    return this.ordersService.getPublicTracking(token);
  }
}
