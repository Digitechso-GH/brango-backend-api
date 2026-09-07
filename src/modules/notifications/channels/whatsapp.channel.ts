import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentStatus } from '@prisma/client';
import { calculateRouteETA } from '../../orders/helpers/geocoding.helper';
const HEADER_IMAGE_POOL = [
  'https://brango.syncrodg.com/logo.png'
];

const EVENT_TYPES = {
  SENT: 'WHATSAPP_NOTIFICATION_SENT',
  FAILED: 'WHATSAPP_NOTIFICATION_FAILED'
};

function formatOrderCodesSummary(codes: string[]): string {
  if (codes.length === 0) return '';
  if (codes.length === 1) return codes[0];
  if (codes.length === 2) return `${codes[0]} y ${codes[1]}`;
  if (codes.length === 3) return `${codes[0]}, ${codes[1]} y ${codes[2]}`;
  
  // Truncado elegante y seguro para límites de caracteres de Meta en casos extremos (4+ pedidos)
  const remaining = codes.length - 2;
  return `${codes[0]}, ${codes[1]} y ${remaining} más`;
}

@Injectable()
export class WhatsappChannel {
  private readonly logger = new Logger(WhatsappChannel.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendTransitNotification(assignment: any, siblings: any[] = []) {
    this.logger.log(`[WhatsApp] Intentando envío real de notificación IN_TRANSIT a Meta para asignación ${assignment?.id} (hermanos: ${siblings?.length || 0})...`);
    
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
      this.logger.error(`[WhatsApp] Faltan credenciales de entorno. Abortando envío para asignación ${assignment?.id}.`);
      return;
    }

    try {
      // 1. Obtener todas las asignaciones completas de la parada (principal + hermanos)
      const allAssignmentIds = [assignment.id, ...(siblings || []).map((s: any) => s.id)];
      const fullAssignments = await this.prisma.routeAssignment.findMany({
        where: { id: { in: allAssignmentIds } },
        include: {
          order: { include: { customer: true } },
          driver: { include: { user: true } },
        },
        orderBy: { sequenceIndex: 'asc' },
      });

      if (!fullAssignments || fullAssignments.length === 0) return;

      const first = fullAssignments[0];
      const driverName = first.driver?.user?.name || 'Nuestro chofer';

      // 2. Disparo al Administrador (1 SOLA alerta para la parada)
      const allOrderCodes = fullAssignments.map((fa) => fa.order.code || fa.order.id.slice(0, 8));
      const adminOrderCodeText = formatOrderCodesSummary(allOrderCodes);

      const distinctCustomerNames = Array.from(
        new Set(fullAssignments.map((fa) => fa.order.customer?.name || fa.order.recipientName || 'nuestro cliente'))
      ).join(' / ');

      const adminComponents = [
        {
          type: 'body',
          parameters: [
            { type: 'text', parameter_name: 'driver_name', text: driverName },
            { type: 'text', parameter_name: 'order_id', text: adminOrderCodeText },
            { type: 'text', parameter_name: 'customer_name', text: distinctCustomerNames }
          ]
        }
      ];
      await this.sendTemplateToMeta(token, phoneId, adminPhone, 'admin_order_alert', 'es_PE', adminComponents);

      // 3. Disparo al Cliente (Agrupación ESTRICTA únicamente por customerId)
      const logoConfig = await this.prisma.systemConfig.findUnique({ where: { key: 'whatsapp_logo_url' } });
      const finalImage = logoConfig?.value || HEADER_IMAGE_POOL[0];

      let etaText = '30 a 60 minutos';
      if (first.originLatitude && first.originLongitude && first.order.latitude && first.order.longitude) {
        const dynamicEta = await calculateRouteETA(
          first.originLatitude,
          first.originLongitude,
          first.order.latitude,
          first.order.longitude
        );
        if (dynamicEta) {
          etaText = dynamicEta;
        }
      }

      // Agrupar asignaciones estrictamente por customerId
      const customerBatches = new Map<string, typeof fullAssignments>();
      const unassignedCustomerAssignments: typeof fullAssignments = [];

      for (const fa of fullAssignments) {
        if (fa.order.customerId) {
          if (!customerBatches.has(fa.order.customerId)) {
            customerBatches.set(fa.order.customerId, []);
          }
          customerBatches.get(fa.order.customerId)!.push(fa);
        } else {
          unassignedCustomerAssignments.push(fa);
        }
      }

      const clientDeliveryGroups: Array<typeof fullAssignments> = [
        ...Array.from(customerBatches.values()),
        ...unassignedCustomerAssignments.map((it) => [it]),
      ];

      for (const groupItems of clientDeliveryGroups) {
        const leadItem = groupItems[0];
        if (!leadItem.order.recipientPhone) continue;

        let customerPhone = leadItem.order.recipientPhone.replace(/\D/g, '');
        if (customerPhone.length === 9) {
          customerPhone = '51' + customerPhone;
        }

        const groupCodes = groupItems.map((gi) => gi.order.code || gi.order.id.slice(0, 8));
        const clientOrderCodeText = formatOrderCodesSummary(groupCodes);

        const trackingToken = leadItem.order.publicTrackingToken || leadItem.order.code;

        if (process.env.NODE_ENV !== 'production') {
          const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
          this.logger.log(`🔗 [DEV TRACKING URL]: ${appUrl}/seguimiento/${trackingToken}`);
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
              { type: 'text', parameter_name: 'order_id', text: clientOrderCodeText },
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

        try {
          await this.sendTemplateToMeta(token, phoneId, customerPhone, 'order_in_transit', 'es_PE', clientComponents);
        } catch (btnErr: any) {
          this.logger.warn(`[WhatsApp] Reintentando envío de order_in_transit sin botón dinámico: ${btnErr.message}`);
          await this.sendTemplateToMeta(token, phoneId, customerPhone, 'order_in_transit', 'es_PE', clientComponents.slice(0, 2));
        }
      }

    } catch (error: any) {
      this.logger.error(`[WhatsApp] Fallo de envío a Meta para parada de asignación ${assignment?.id}: ${error.message}`);
      
      await this.prisma.orderEvent.create({
        data: {
          routeAssignmentId: assignment.id,
          type: 'TRANSIT_NOTIFICATION_FAILED',
          actor: 'system',
          metadata: { error: error.message },
        },
      });
    }
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
