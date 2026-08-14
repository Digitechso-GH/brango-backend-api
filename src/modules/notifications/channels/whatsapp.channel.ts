import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WhatsappChannel {
  private readonly logger = new Logger(WhatsappChannel.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendTransitNotification(assignment: any) {
    this.logger.log(`[WhatsApp] Intentando envío real de notificación IN_TRANSIT a Meta para asignación ${assignment.id}...`);
    
    const token = process.env.WHATSAPP_TOKEN || 'FALLO_FORZADO';
    const phoneId = process.env.WHATSAPP_PHONE_ID || '123456789';

    try {
      // Llamada HTTP real a la API de WhatsApp Cloud
      const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: '51999999999', // dummy
          type: 'template',
          template: { name: 'transit_started', language: { code: 'es' } }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Meta API Error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

    } catch (error: any) {
      this.logger.error(`[WhatsApp] Fallo de red/API real contra Meta para ${assignment.id}: ${error.message}`);
      
      // Registrar falla silenciosa real
      await this.prisma.orderEvent.create({
        data: {
          routeAssignmentId: assignment.id,
          type: 'WHATSAPP_NOTIFICATION_FAILED',
          actor: 'system',
          metadata: { reason: error.message },
        },
      });
      return;
    }

    this.logger.log(`[WhatsApp] Notificación IN_TRANSIT enviada exitosamente para ${assignment.id}`);
    
    await this.prisma.orderEvent.create({
      data: {
        routeAssignmentId: assignment.id,
        type: 'WHATSAPP_NOTIFICATION_SENT',
        actor: 'system',
        metadata: { channel: 'whatsapp', template: 'transit_started' },
      },
    });
  }
}
