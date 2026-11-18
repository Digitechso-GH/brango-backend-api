import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WhatsappChannel } from './channels/whatsapp.channel';
import { AyraWebhookChannel } from './channels/ayra-webhook.channel';
import type { RouteAssignment } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly whatsappChannel: WhatsappChannel,
    private readonly ayraWebhook: AyraWebhookChannel,
  ) {}

  @OnEvent('order.transit_started')
  async handleOrderTransitStarted(payload: any) {
    const assignment: RouteAssignment = payload?.assignment || payload;
    const siblings: RouteAssignment[] = payload?.siblings || [];
    this.logger.log(`[Notifications] Capturado evento 'order.transit_started' para asignación ${assignment?.id} (hermanos: ${siblings.length})`);
    
    // Delegar al canal de WhatsApp (Fire and forget, no bloquea el event emitter)
    this.whatsappChannel.sendTransitNotification(assignment, siblings).catch(err => {
      this.logger.error(`[Notifications] Error no controlado en WhatsApp Channel: ${err.message}`);
    });

    if (assignment?.id) {
      this.ayraWebhook
        .sendTransitOrders(
          assignment.id,
          siblings.map((s) => s.id),
        )
        .catch((err) => {
          this.logger.error(`[Notifications] Error enviando webhook a Ayra (IN_TRANSIT): ${err.message}`);
        });
    }
  }

  @OnEvent('order.completed')
  async handleOrderCompleted(assignment: RouteAssignment) {
    this.logger.log(`[Notifications] Capturado evento 'order.completed' para asignación ${assignment.id}`);
    
    this.whatsappChannel.sendCompletionNotification(assignment).catch(err => {
      this.logger.error(`[Notifications] Error no controlado en WhatsApp Channel: ${err.message}`);
    });

    if (assignment?.id) {
      this.ayraWebhook.sendCompletionOrder(assignment.id).catch((err) => {
        this.logger.error(`[Notifications] Error enviando webhook a Ayra (COMPLETED): ${err.message}`);
      });
    }
  }
}
