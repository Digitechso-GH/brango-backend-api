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
        WHATSAPP_TEMPLATES.ADMIN_ORDER_COMPLETED,
        components
      );
      this.logger.log(`[WhatsApp] Notificación COMPLETED enviada exitosamente al admin para ${assignment.id}`);

      // Enviar también al Contacto Comercial (warehouseContact)
      const commercialPhone = normalizePeruvianPhoneNumber(fullAssignment.order.warehouseContact);
      if (commercialPhone) {
        try {
          await this.sendTemplateWithLangFallback(
            token,
            phoneId,
            commercialPhone,
            WHATSAPP_TEMPLATES.ADMIN_ORDER_COMPLETED,
            components
          );
          this.logger.log(`[WhatsApp] Notificación COMPLETED enviada exitosamente a comercial ${commercialPhone} para ${assignment.id}`);
        } catch (commErr: any) {
          this.logger.warn(`[WhatsApp] Fallo al enviar COMPLETED a comercial ${commercialPhone}: ${commErr.message}`);
        }
      }
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
