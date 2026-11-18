import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AssignmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AyraWebhookChannel {
  private readonly logger = new Logger(AyraWebhookChannel.name);

  constructor(private readonly prisma: PrismaService) {}

  private getConfig() {
    const url = process.env.AYRA_WEBHOOK_URL?.trim();
    const apiKey = process.env.AYRA_API_KEY?.trim();
    const hmacSecret = process.env.AYRA_HMAC_SECRET?.trim();
    if (!url || !apiKey) return null;
    return { url, apiKey, hmacSecret };
  }

  async sendTransitOrders(assignmentId: string, siblingIds: string[] = []): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg) return;

    const allIds = [assignmentId, ...siblingIds].filter(Boolean);
    const assignments = await this.prisma.routeAssignment.findMany({
      where: { id: { in: allIds } },
      include: {
        order: { include: { customer: true } },
        driver: { include: { user: true } },
        vehicle: true,
      },
    });

    for (const fa of assignments) {
      const commercialPhone = fa.order.warehouseContact?.trim();
      if (!commercialPhone) continue;

      const driverName = fa.driver?.user?.name || 'Transportista';
      const plate = fa.driver?.unit || fa.vehicle?.plate || '';
      const carrierName = plate ? `${driverName} (${plate})` : driverName;

      await this.postWebhook(cfg, {
        externalOrderId: fa.order.code || fa.order.id.slice(0, 8),
        externalEventId: `${fa.id}-IN_TRANSIT`,
        originCode: 'IN_TRANSIT',
        commercialPhone,
        customerName: fa.order.customer?.name || fa.order.recipientName || 'Cliente',
        ...(fa.order.recipientDocument ? { customerRuc: fa.order.recipientDocument } : {}),
        customerAddress: fa.order.formattedAddress || fa.order.rawAddress,
        carrierName,
        ...(fa.driver?.phone ? { carrierPhone: fa.driver.phone } : {}),
        actor: 'Brango TMS',
        note: 'Pedido en ruta de entrega.',
        occurredAt: new Date().toISOString(),
      });
    }
  }

  async sendCompletionOrder(assignmentId: string): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg) return;

    const fa = await this.prisma.routeAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        order: { include: { customer: true } },
        driver: { include: { user: true } },
        vehicle: true,
        evidences: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!fa) return;

    const commercialPhone = fa.order.warehouseContact?.trim();
    if (!commercialPhone) return;

    const originCode =
      fa.status === AssignmentStatus.OBSERVED ? 'OBSERVED' : 'DELIVERED';
    const driverName = fa.driver?.user?.name || 'Transportista';
    const plate = fa.driver?.unit || fa.vehicle?.plate || '';
    const carrierName = plate ? `${driverName} (${plate})` : driverName;
    const latestEvidence = fa.evidences[0];

    await this.postWebhook(cfg, {
      externalOrderId: fa.order.code || fa.order.id.slice(0, 8),
      externalEventId: `${fa.id}-${originCode}`,
      originCode,
      commercialPhone,
      customerName: fa.order.customer?.name || fa.order.recipientName || 'Cliente',
      ...(fa.order.recipientDocument ? { customerRuc: fa.order.recipientDocument } : {}),
      customerAddress: fa.order.formattedAddress || fa.order.rawAddress,
      carrierName,
      ...(fa.driver?.phone ? { carrierPhone: fa.driver.phone } : {}),
      actor: 'Brango TMS',
      note:
        fa.reasonText?.trim() ||
        (originCode === 'DELIVERED'
          ? 'Entrega confirmada por transportista.'
          : 'Entrega observada en punto.'),
      occurredAt: new Date().toISOString(),
      ...(latestEvidence
        ? {
            evidence: {
              imageUrl: latestEvidence.s3Url,
              notes: latestEvidence.signatureText || fa.reasonText || undefined,
              capturedAt: latestEvidence.createdAt.toISOString(),
            },
          }
        : {}),
    });
  }

  private async postWebhook(
    cfg: { url: string; apiKey: string; hmacSecret?: string },
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Api-Key': cfg.apiKey,
    };

    if (cfg.hmacSecret) {
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', cfg.hmacSecret)
        .update(`${ts}.${body}`)
        .digest('hex');
      headers['X-Webhook-Timestamp'] = ts;
      headers['X-Webhook-Signature'] = `sha256=${sig}`;
    }

    const res = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ayra webhook responded ${res.status}: ${text}`);
    }

    this.logger.log(
      `[AyraWebhook] Sincronizado pedido ${String(payload.externalOrderId)} (${String(payload.originCode)})`,
    );
  }
}
