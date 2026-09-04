import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AssignmentStatus } from '@prisma/client';
import { OrdersService } from './orders.service';
import { TIMEZONE, getLimaDayRange } from '../../core/utils/date.util';

@Injectable()
export class OrdersCronService {
  private readonly logger = new Logger(OrdersCronService.name);

  constructor(private readonly ordersService: OrdersService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: TIMEZONE })
  async handleEodClosure() {
    this.logger.log('Starting End of Day (EOD) auto-closure of route assignments...');

    const endOfDay = getLimaDayRange().endOfDay;

    const closedCount = await this.ordersService.executeAutoClosure({
      date: {
        lte: endOfDay,
      },
      status: {
        in: [AssignmentStatus.PENDING, AssignmentStatus.IN_TRANSIT],
      },
    });

    if (closedCount === 0) {
      this.logger.log('No unresolved assignments found for today.');
    } else {
      this.logger.log(`EOD auto-closure completed. Automatically closed ${closedCount} assignments.`);
    }
  }
}
