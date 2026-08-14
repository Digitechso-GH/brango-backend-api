import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { WhatsappChannel } from './channels/whatsapp.channel';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [NotificationsService, WhatsappChannel],
  exports: [NotificationsService],
})
export class NotificationsModule {}
