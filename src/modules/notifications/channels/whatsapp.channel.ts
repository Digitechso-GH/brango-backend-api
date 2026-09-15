import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ORDER_EVENT_TYPES } from '../../orders/constants/order-events.constants';
import { calculateRouteETA } from '../../orders/helpers/geocoding.helper';
import {
  WHATSAPP_TEMPLATES,
  MetaTemplateComponent,
  normalizePeruvianPhoneNumber,
  formatOrderCodesSummary,
  buildAdminTransitAlertComponents,
  buildCustomerTransitComponents,
  buildWarehouseTransitComponents,
  buildAdminCompletionComponents,
} from '../templates/whatsapp-templates.builder';

const HEADER_IMAGE_POOL = [
  'https://brango.syncrodg.com/logo.png',
];

@Injectable()
export class WhatsappChannel {
  private readonly logger = new Logger(WhatsappChannel.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendTransitNotification(assignment: any, siblings: any[] = []) {
    this.logger.log(`[WhatsApp] Intentando envío real de notificación IN_TRANSIT a Meta para asignación ${assignment?.id} (hermanos: ${siblings?.length || 0})...`);

    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneId) {
      this.logger.error(`[WhatsApp] Faltan credenciales de Meta (WHATSAPP_TOKEN o WHATSAPP_PHONE_ID / WHATSAPP_PHONE_NUMBER_ID). Abortando envío para asignación ${assignment?.id}.`);
      return;
    }

    // Leer número admin de la base de datos o de variable de entorno (fallback)
    const config = await this.prisma.systemConfig.findUnique({ where: { key: 'whatsapp_admin_phone' } });
    const adminPhone = normalizePeruvianPhoneNumber(config?.value || process.env.WHATSAPP_ADMIN_PHONE);

    try {
      // 1. Obtener todas las asignaciones completas de la parada (principal + hermanos)
      const allAssignmentIds = [assignment.id, ...(siblings || []).map((s: any) => s.id)];
      const fullAssignments = await this.prisma.routeAssignment.findMany({
        where: { id: { in: allAssignmentIds } },
        include: {
          order: { include: { customer: true, originBranch: true } },
          driver: { include: { user: true } },
          vehicle: true,
        },
        orderBy: { sequenceIndex: 'asc' },
      });

      if (!fullAssignments || fullAssignments.length === 0) return;

      const first = fullAssignments[0];
      const driverName = first.driver?.user?.name || 'Nuestro chofer';
      const driverUnit = first.driver?.unit || first.vehicle?.plate || '';
      const driverWithUnit = driverUnit ? `${driverName} (${driverUnit})` : driverName;

      // 2. Disparo al Administrador (Aislado para no bloquear el envío al cliente)
      if (adminPhone) {
        try {
          const allOrderCodes = fullAssignments.map((fa) => fa.order.code || fa.order.id.slice(0, 8));
          const adminOrderCodeText = formatOrderCodesSummary(allOrderCodes);

          const distinctCustomerNames = Array.from(
            new Set(fullAssignments.map((fa) => fa.order.customer?.name || fa.order.recipientName || 'nuestro cliente'))
          ).join(' / ');

          const adminComponents = buildAdminTransitAlertComponents({
            driverName,
            orderCodesSummary: adminOrderCodeText,
            customerNamesSummary: distinctCustomerNames,
          });

          await this.sendTemplateWithLangFallback(
            token,
            phoneId,
            adminPhone,
            WHATSAPP_TEMPLATES.ADMIN_ORDER_ALERT,
            adminComponents
          );
          this.logger.log(`[WhatsApp] Alerta de administrador enviada exitosamente a ${adminPhone}`);
        } catch (adminErr: any) {
          this.logger.warn(`[WhatsApp] No se pudo enviar alerta al admin (${adminPhone}): ${adminErr.message}. Continuando con clientes.`);
        }
      } else {
        this.logger.warn(`[WhatsApp] whatsapp_admin_phone no configurado. Continuando con notificación al cliente.`);
      }

      // 3. Obtener Logo y ETA común para la parada
      const logoConfig = await this.prisma.systemConfig.findUnique({ where: { key: 'whatsapp_logo_url' } });
      const finalImage = logoConfig?.value || HEADER_IMAGE_POOL[0];

      let etaText = '30 a 60 minutos';
      const originLat = first.originLatitude ?? first.order?.originBranch?.latitude;
      const originLng = first.originLongitude ?? first.order?.originBranch?.longitude;
      const destLat = first.order?.latitude;
      const destLng = first.order?.longitude;

      if (originLat && originLng && destLat && destLng) {
        const dynamicEta = await calculateRouteETA(originLat, originLng, destLat, destLng);
        if (dynamicEta) {
          etaText = dynamicEta;
          this.logger.log(`[WhatsApp] ETA en tiempo real calculado por Google Maps para pedido ${first.order?.code}: ${etaText}`);
        } else {
          this.logger.warn(`[WhatsApp] Google Maps no devolvió ETA para pedido ${first.order?.code}. Usando fallback: ${etaText}`);
        }
      } else {
        this.logger.warn(`[WhatsApp] Coordenadas insuficientes para calcular ETA (origin: ${originLat},${originLng} | dest: ${destLat},${destLng}). Usando fallback: ${etaText}`);
      }

      // 4. Disparo al Cliente (Agrupación ESTRICTA únicamente por customerId)
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
        const customerPhone = normalizePeruvianPhoneNumber(leadItem.order.recipientPhone);
        if (!customerPhone) {
          this.logger.warn(`[WhatsApp] Pedido ${leadItem.order.code} sin teléfono válido de destinatario. Se omite envío al cliente.`);
          continue;
        }

        const groupCodes = groupItems.map((gi) => gi.order.code || gi.order.id.slice(0, 8));
        const clientOrderCodeText = formatOrderCodesSummary(groupCodes);
        const trackingToken = leadItem.order.publicTrackingToken || leadItem.order.code;

        if (process.env.NODE_ENV !== 'production') {
          const appUrl = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
          this.logger.log(`🔗 [DEV TRACKING URL]: ${appUrl}/seguimiento/${trackingToken}`);
        }

        const clientComponents = buildCustomerTransitComponents({
          storeName: leadItem.order.customer?.name || leadItem.order.recipientName || 'BranGo',
          orderCodesSummary: clientOrderCodeText,
          etaText,
          trackingToken,
          headerImageUrl: finalImage,
        });

        try {
          await this.sendTemplateWithLangFallback(
            token,
            phoneId,
            customerPhone,
            WHATSAPP_TEMPLATES.ORDER_IN_TRANSIT,
            clientComponents,
            true
          );

          this.logger.log(`[WhatsApp] Mensaje de tránsito enviado exitosamente a cliente ${customerPhone} para pedido(s) ${clientOrderCodeText}`);

          for (const item of groupItems) {
            await this.prisma.orderEvent.create({
              data: {
                routeAssignmentId: item.id,
                type: ORDER_EVENT_TYPES.WHATSAPP_SENT,
                actor: 'system',
                metadata: {
                  phone: customerPhone,
                  template: WHATSAPP_TEMPLATES.ORDER_IN_TRANSIT,
                  recipientType: 'customer',
                },
              },
            });
          }
        } catch (clientErr: any) {
          this.logger.error(`[WhatsApp] Error enviando a cliente ${customerPhone}: ${clientErr.message}`);

          for (const item of groupItems) {
            await this.prisma.orderEvent.create({
              data: {
                routeAssignmentId: item.id,
                type: ORDER_EVENT_TYPES.WHATSAPP_FAILED,
                actor: 'system',
                metadata: {
                  error: clientErr.message,
                  phone: customerPhone,
                  recipientType: 'customer',
                },
              },
            });
          }
        }
      }

      // 5. Disparo al Contacto de Almacén (Agrupación por teléfono de warehouseContact si existe)
      // ⚠️ BANDERA DE ACTIVACIÓN:
      // Cambiar a true (o definir ENABLE_WAREHOUSE_NOTIFICATIONS=true en .env) una vez creada y aprobada
      // la plantilla 'order_in_transit_warehouse' en Meta Business Manager.
      // Mientras sea false, no ejecutará la llamada a Meta ni generará eventos de error en la línea de tiempo.
      const IS_WAREHOUSE_TEMPLATE_ACTIVE = process.env.ENABLE_WAREHOUSE_NOTIFICATIONS === 'true' || false;

      if (!IS_WAREHOUSE_TEMPLATE_ACTIVE) {
        this.logger.log(
          `[WhatsApp] Notificación a almacén en espera: la plantilla '${WHATSAPP_TEMPLATES.ORDER_IN_TRANSIT_WAREHOUSE}' aún no está activa en Meta. Se omite para no ensuciar la línea de tiempo.`
        );
      } else {
      const warehouseBatches = new Map<string, typeof fullAssignments>();
      for (const fa of fullAssignments) {
        const warehousePhone = normalizePeruvianPhoneNumber(fa.order.warehouseContact);
        if (warehousePhone) {
          if (!warehouseBatches.has(warehousePhone)) {
            warehouseBatches.set(warehousePhone, []);
          }
          warehouseBatches.get(warehousePhone)!.push(fa);
        }
      }

      for (const [warehousePhone, whGroupItems] of warehouseBatches.entries()) {
        const leadItem = whGroupItems[0];
        const warehouseCodesWithWaybill = whGroupItems
          .map((gi) => {
            const code = gi.order.code || gi.order.id.slice(0, 8);
            return gi.order.waybill ? `${code} (GR: ${gi.order.waybill})` : code;
          })
          .join(', ');

        const trackingToken = leadItem.order.publicTrackingToken || leadItem.order.code;
        const warehouseOrClientName = leadItem.order.customer?.name || leadItem.order.recipientName || 'Almacén';

        const warehouseComponents = buildWarehouseTransitComponents({
          warehouseOrClientName,
          orderCodesWithWaybill: warehouseCodesWithWaybill,
          driverWithUnit,
          etaText,
          trackingToken,
          headerImageUrl: finalImage,
        });

        try {
          await this.sendTemplateWithLangFallback(
            token,
            phoneId,
            warehousePhone,
            WHATSAPP_TEMPLATES.ORDER_IN_TRANSIT_WAREHOUSE,
            warehouseComponents,
            true
          );

          this.logger.log(`[WhatsApp] Notificación de tránsito enviada exitosamente a almacén ${warehousePhone} para pedido(s) ${warehouseCodesWithWaybill}`);

          for (const item of whGroupItems) {
            await this.prisma.orderEvent.create({
              data: {
                routeAssignmentId: item.id,
                type: ORDER_EVENT_TYPES.WHATSAPP_WAREHOUSE_SENT,
                actor: 'system',
                metadata: {
                  phone: warehousePhone,
                  template: WHATSAPP_TEMPLATES.ORDER_IN_TRANSIT_WAREHOUSE,
                },
              },
            });
          }
        } catch (whErr: any) {
          this.logger.warn(`[WhatsApp] Fallo al enviar notificación a contacto de almacén ${warehousePhone} (plantilla '${WHATSAPP_TEMPLATES.ORDER_IN_TRANSIT_WAREHOUSE}'): ${whErr.message}`);

          for (const item of whGroupItems) {
            await this.prisma.orderEvent.create({
              data: {
                routeAssignmentId: item.id,
                type: ORDER_EVENT_TYPES.WHATSAPP_WAREHOUSE_FAILED,
                actor: 'system',
                metadata: {
                  error: whErr.message,
                  phone: warehousePhone,
                },
              },
            });
          }
        }
      }
      }

    } catch (error: any) {
      this.logger.error(`[WhatsApp] Fallo general en notificación IN_TRANSIT para parada ${assignment?.id}: ${error.message}`);
    }
  }

  async sendCompletionNotification(assignment: any) {
    this.logger.log(`[WhatsApp] Intentando envío de notificación COMPLETED a Meta para asignación ${assignment.id}...`);

    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;

    // Leer número admin de la base de datos o env fallback
    const config = await this.prisma.systemConfig.findUnique({ where: { key: 'whatsapp_admin_phone' } });
    const adminPhone = normalizePeruvianPhoneNumber(config?.value || process.env.WHATSAPP_ADMIN_PHONE);

    if (!token || !phoneId || !adminPhone) {
      this.logger.warn(`[WhatsApp] Faltan credenciales o whatsapp_admin_phone. Omitiendo notificación COMPLETED para ${assignment.id}.`);
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

      let finalImage = 'https://brango.syncrodg.com/logo.png';
      if (fullAssignment.evidences && fullAssignment.evidences.length > 0) {
        finalImage = fullAssignment.evidences[fullAssignment.evidences.length - 1].s3Url;
      } else {
        const logoConfig = await this.prisma.systemConfig.findUnique({ where: { key: 'whatsapp_logo_url' } });
        if (logoConfig?.value) finalImage = logoConfig.value;
      }

      const components = buildAdminCompletionComponents({
        orderCode,
        statusText: statusStr,
        driverName,
        headerImageUrl: finalImage,
      });

      await this.sendTemplateWithLangFallback(
        token,
        phoneId,
        adminPhone,
        WHATSAPP_TEMPLATES.ADMIN_ORDER_COMPLETED,
        components
      );
      this.logger.log(`[WhatsApp] Notificación COMPLETED enviada exitosamente para ${assignment.id}`);
    } catch (error: any) {
      this.logger.error(`[WhatsApp] Fallo contra Meta (COMPLETED) para ${assignment.id}: ${error.message}`);
    }
  }

  // Método con reintentos inteligentes de idioma ('es_PE' -> 'es_LA' -> 'es') y fallback sin botones
  private async sendTemplateWithLangFallback(
    token: string,
    phoneId: string,
    toPhone: string,
    templateName: string,
    components: MetaTemplateComponent[] = [],
    allowWithoutButtons = false
  ) {
    const langCodes = ['es_PE', 'es_LA', 'es'];
    let lastError: any = null;

    for (const lang of langCodes) {
      try {
        await this.sendTemplateToMeta(token, phoneId, toPhone, templateName, lang, components);
        return;
      } catch (err: any) {
        lastError = err;
        const msg = err.message || '';

        // Si el error es por idioma no soportado de la plantilla, probar siguiente idioma
        if (msg.includes('does not exist') || msg.includes('132001') || msg.includes('132000')) {
          this.logger.warn(`[WhatsApp] Plantilla '${templateName}' no existe en idioma '${lang}'. Probando siguiente variante...`);
          continue;
        }

        // Si falló por estructura de botón y allowWithoutButtons está activo
        if (allowWithoutButtons && components.some((c) => c.type === 'button')) {
          this.logger.warn(`[WhatsApp] Reintentando plantilla '${templateName}' (${lang}) sin botón interactivo para ${toPhone}...`);
          try {
            const noBtnComponents = components.filter((c) => c.type !== 'button');
            await this.sendTemplateToMeta(token, phoneId, toPhone, templateName, lang, noBtnComponents);
            return;
          } catch (btnErr: any) {
            lastError = btnErr;
          }
        }
        break;
      }
    }

    throw lastError;
  }

  // Método privado para realizar la petición HTTP contra Meta Graph API
  private async sendTemplateToMeta(
    token: string,
    phoneId: string,
    toPhone: string,
    templateName: string,
    langCode: string,
    components: MetaTemplateComponent[] = []
  ) {
    const payload: any = {
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: langCode },
      },
    };

    if (components.length > 0) {
      payload.template.components = components;
    }

    const response = await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Meta API Error for ${toPhone}: ${response.status} - ${JSON.stringify(errorData)}`);
    }
  }
}
