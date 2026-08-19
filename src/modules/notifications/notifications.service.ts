import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WhatsappChannel } from './channels/whatsapp.channel';
import type { RouteAssignment } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly whatsappChannel: WhatsappChannel) {}

  @OnEvent('order.transit_started')
  async handleOrderTransitStarted(assignment: RouteAssignment) {
    this.logger.log(`[Notifications] Capturado evento 'order.transit_started' para asignación ${assignment.id}`);
    
    // Delegar al canal de WhatsApp (Fire and forget, no bloquea el event emitter)
    this.whatsappChannel.sendTransitNotification(assignment).catch(err => {
      this.logger.error(`[Notifications] Error no controlado en WhatsApp Channel: ${err.message}`);
    });
  }

  @OnEvent('order.completed')
  async handleOrderCompleted(assignment: RouteAssignment) {
    this.logger.log(`[Notifications] Capturado evento 'order.completed' para asignación ${assignment.id}`);
    
    this.whatsappChannel.sendCompletionNotification(assignment).catch(err => {
      this.logger.error(`[Notifications] Error no controlado en WhatsApp Channel: ${err.message}`);
    });
  }
}
