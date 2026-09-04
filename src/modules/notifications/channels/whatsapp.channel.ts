import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentStatus } from '@prisma/client';
import { calculateRouteETA } from '../../orders/helpers/geocoding.helper';
const HEADER_IMAGE_POOL = [
  'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png'
];

const EVENT_TYPES = {
  SENT: 'WHATSAPP_NOTIFICATION_SENT',
  FAILED: 'WHATSAPP_NOTIFICATION_FAILED'
};

@Injectable()
export class WhatsappChannel {
  private readonly logger = new Logger(WhatsappChannel.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendTransitNotification(assignment: any) {
    this.logger.log(`[WhatsApp] Intentando envío real de notificación IN_TRANSIT a Meta para asignación ${assignment.id}...`);
    
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    
    // Leer número admin de la base de datos (única fuente de verdad)
    const config = await this.prisma.systemConfig.findUnique({ where: { key: 'whatsapp_admin_phone' } });
    let adminPhone = config?.value;
    
    // Formatear adminPhone (solo números y obligar código de país 51)
    if (adminPhone) {
      adminPhone = adminPhone.replace(/\D/g, '');
      if (adminPhone.length === 9) adminPhone = '51' + adminPhone;
    }

    if (!token || !phoneId || !adminPhone) {
      this.logger.error(`[WhatsApp] Faltan credenciales de entorno. Abortando envío para asignación ${assignment.id}.`);
      return;
    }

    const appUrl = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.APP_URL || 'https://brango.syncrodg.com';
    let trackingUrl = '';

    try {
      // 1. Obtener la orden completa para sacar datos y teléfono
      const fullAssignment = await this.prisma.routeAssignment.findUnique({
        where: { id: assignment.id },
        include: { order: true, driver: { include: { user: true } } },
      });

      if (!fullAssignment || !fullAssignment.order) return;

      const orderCode = fullAssignment.order.code || fullAssignment.order.id.slice(0, 8);
      const driverName = fullAssignment.driver?.user?.name || 'Nuestro chofer';
      const customerName = fullAssignment.order.recipientName || 'nuestro cliente';
      const trackingToken = fullAssignment.order.publicTrackingToken || orderCode;
      trackingUrl = `${appUrl}/seguimiento/${trackingToken}`;

      // 2. Disparo al Administrador (Plantilla de Alerta)
      const adminComponents = [
        {
          type: 'body',
          parameters: [
            { type: 'text', parameter_name: 'driver_name', text: driverName },
            { type: 'text', parameter_name: 'order_id', text: orderCode },
            { type: 'text', parameter_name: 'customer_name', text: customerName }
          ]
        }
      ];
      await this.sendTemplateToMeta(token, phoneId, adminPhone, 'admin_order_alert', 'es_PE', adminComponents);

      // 3. Disparo al Cliente (Plantilla con Link de Seguimiento)
      if (fullAssignment.order.recipientPhone) {
        let customerPhone = fullAssignment.order.recipientPhone.replace(/\D/g, '');
        if (customerPhone.length === 9) {
          customerPhone = '51' + customerPhone;
        }

        const logoConfig = await this.prisma.systemConfig.findUnique({ where: { key: 'whatsapp_logo_url' } });
        const finalImage = logoConfig?.value || HEADER_IMAGE_POOL[0];

        let etaText = '30 a 60 minutos';
        if (fullAssignment.originLatitude && fullAssignment.originLongitude && fullAssignment.order.latitude && fullAssignment.order.longitude) {
          const dynamicEta = await calculateRouteETA(
            fullAssignment.originLatitude,
            fullAssignment.originLongitude,
            fullAssignment.order.latitude,
            fullAssignment.order.longitude
          );
          if (dynamicEta) {
            etaText = dynamicEta;
          }
        }

        const clientComponents = [
          {
            type: 'header',
            parameters: [
              {
                type: 'image',
                image: { link: finalImage }
              }
            ]
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', parameter_name: 'store_name', text: 'BranGo' },
              { type: 'text', parameter_name: 'order_id', text: orderCode },
              { type: 'text', parameter_name: 'eta', text: etaText }
            ]
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: trackingToken
              }
            ]
          }
        ];

        // Intentar envío con botón de tracking; si la plantilla en Meta no tiene botón configurado, fallback al payload estándar
        try {
          await this.sendTemplateToMeta(token, phoneId, customerPhone, 'order_in_transit', 'es_PE', clientComponents);
        } catch (btnErr: any) {
          this.logger.warn(`[WhatsApp] Reintentando envío de order_in_transit sin componente de botón dinámico: ${btnErr.message}`);
          await this.sendTemplateToMeta(token, phoneId, customerPhone, 'order_in_transit', 'es_PE', clientComponents.slice(0, 2));
        }
      }

    } catch (error: any) {
      this.logger.error(`[WhatsApp] Fallo de envío a Meta para asignación ${assignment.id}: ${error.message}`);
      
      // Registrar evento de falla explícito en la base de datos para auditoría y reintento manual
      await this.prisma.orderEvent.create({
        data: {
          routeAssignmentId: assignment.id,
          type: EVENT_TYPES.FAILED,
          actor: 'system',
          metadata: { 
            channel: 'whatsapp',
            template: 'order_in_transit',
            reason: error.message,
            trackingUrl: trackingUrl || undefined,
            failedAt: new Date().toISOString(),
          },
        },
      });
      return;
    }

    this.logger.log(`[WhatsApp] Notificación IN_TRANSIT enviada exitosamente para ${assignment.id}. Tracking URL: ${trackingUrl}`);
    
    await this.prisma.orderEvent.create({
      data: {
        routeAssignmentId: assignment.id,
        type: EVENT_TYPES.SENT,
        actor: 'system',
        metadata: { 
          channel: 'whatsapp', 
          template: 'order_in_transit',
          trackingUrl,
        },
      },
    });
  }

  async sendCompletionNotification(assignment: any) {
    this.logger.log(`[WhatsApp] Intentando envío de notificación COMPLETED a Meta para asignación ${assignment.id}...`);
    
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    
    // Leer número admin de la base de datos (única fuente de verdad)
    const config = await this.prisma.systemConfig.findUnique({ where: { key: 'whatsapp_admin_phone' } });
    let adminPhone = config?.value;

    // Formatear adminPhone (solo números y obligar código de país 51)
    if (adminPhone) {
      adminPhone = adminPhone.replace(/\D/g, '');
      if (adminPhone.length === 9) adminPhone = '51' + adminPhone;
    }

    if (!token || !phoneId || !adminPhone) {
      this.logger.error(`[WhatsApp] Faltan credenciales de entorno. Abortando envío para asignación ${assignment.id}.`);
      return;
    }

    try {
      const fullAssignment = await this.prisma.routeAssignment.findUnique({
        where: { id: assignment.id },
        include: { order: true, driver: { include: { user: true } }, evidences: true },
      });

      if (!fullAssignment || !fullAssignment.order) return;

      const orderCode = fullAssignment.order.code || fullAssignment.order.id.slice(0, 8);
      const driverName = fullAssignment.driver?.user?.name || 'Nuestro chofer';
      const statusStr = fullAssignment.status === 'DELIVERED' ? 'ENTREGADO' : 'OBSERVADO';

      // Usar foto de evidencia si existe, si no, fallback al logo
      let finalImage = 'https://brango.syncrodg.com/logo.png';
      if (fullAssignment.evidences && fullAssignment.evidences.length > 0) {
        finalImage = fullAssignment.evidences[fullAssignment.evidences.length - 1].s3Url;
      } else {
        const logoConfig = await this.prisma.systemConfig.findUnique({ where: { key: 'whatsapp_logo_url' } });
        if (logoConfig?.value) finalImage = logoConfig.value;
      }

      const components = [
        {
          type: 'header',
          parameters: [
            {
              type: 'image',
              image: { link: finalImage }
            }
          ]
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', parameter_name: 'order_id', text: orderCode },
            { type: 'text', parameter_name: 'status', text: statusStr },
            { type: 'text', parameter_name: 'driver_name', text: driverName }
          ]
        }
      ];
      try {
        await this.sendTemplateToMeta(token, phoneId, adminPhone, 'admin_order_completed', 'es_PE', components);
      } catch (err: any) {
        if (err.message.includes('does not exist')) {
          this.logger.warn(`[WhatsApp] Reintentando admin_order_completed con idioma 'es_LA'...`);
          try {
            await this.sendTemplateToMeta(token, phoneId, adminPhone, 'admin_order_completed', 'es_LA', components);
          } catch (err2: any) {
            if (err2.message.includes('does not exist')) {
               this.logger.warn(`[WhatsApp] Reintentando admin_order_completed con idioma 'es'...`);
               await this.sendTemplateToMeta(token, phoneId, adminPhone, 'admin_order_completed', 'es', components);
            } else {
               throw err2;
            }
          }
        } else {
          throw err;
        }
      }

    } catch (error: any) {
      this.logger.error(`[WhatsApp] Fallo de red/API real contra Meta (COMPLETED) para ${assignment.id}: ${error.message}`);
      return;
    }

    this.logger.log(`[WhatsApp] Notificación COMPLETED enviada exitosamente para ${assignment.id}`);
  }

  // Método privado para reutilizar la lógica de envío a Meta
  private async sendTemplateToMeta(token: string, phoneId: string, toPhone: string, templateName: string, langCode: string, components: any[] = []) {
    const payload: any = {
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'template',
      template: { 
        name: templateName, 
        language: { code: langCode }
      }
    };

    if (components.length > 0) {
      payload.template.components = components;
    }

    const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Meta API Error for ${toPhone}: ${response.status} - ${JSON.stringify(errorData)}`);
    }
  }
}
