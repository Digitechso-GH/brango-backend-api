import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { WhatsappChannel } from './channels/whatsapp.channel';
import { AyraWebhookChannel } from './channels/ayra-webhook.channel';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [NotificationsService, WhatsappChannel, AyraWebhookChannel],
  exports: [NotificationsService],
})
export class NotificationsModule {}
