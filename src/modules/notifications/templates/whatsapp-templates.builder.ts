/**
 * WhatsApp Meta Template Registry & Builder
 * Centralizes all Meta WhatsApp template names, parameter schemas, and payload builders.
 */

export const WHATSAPP_TEMPLATES = {
  ADMIN_ORDER_ALERT: 'admin_order_alert',
  ORDER_IN_TRANSIT: 'order_in_transit',
  ORDER_IN_TRANSIT_WAREHOUSE: 'order_in_transit_warehouse',
  ADMIN_ORDER_COMPLETED: 'admin_order_completed',
} as const;

export type WhatsappTemplateName = typeof WHATSAPP_TEMPLATES[keyof typeof WHATSAPP_TEMPLATES];

export interface MetaTemplateParameter {
  type: 'text' | 'image' | 'document' | 'video';
  parameter_name?: string;
  text?: string;
  image?: { link: string };
  [key: string]: any;
}

export interface MetaTemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'url' | 'quick_reply';
  index?: string;
  parameters?: MetaTemplateParameter[];
}

/**
 * Normalizes phone numbers to standard Peruvian format (51XXXXXXXXX)
 */
export function normalizePeruvianPhoneNumber(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;
  let digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 9) {
    digits = '51' + digits;
  }
  return digits.length >= 9 ? digits : null;
}

/**
 * Formats a list of order codes into a readable, concise summary string.
 * e.g. ["ORD-001"] -> "ORD-001"
 * e.g. ["ORD-001", "ORD-002"] -> "ORD-001 y ORD-002"
 * e.g. ["ORD-001", "ORD-002", "ORD-003"] -> "ORD-001, ORD-002 y ORD-003"
 * e.g. ["ORD-001", "ORD-002", "ORD-003", "ORD-004"] -> "ORD-001, ORD-002 y 2 más"
 */
export function formatOrderCodesSummary(codes: string[]): string {
  if (!codes || codes.length === 0) return '';
  if (codes.length === 1) return codes[0];
  if (codes.length === 2) return `${codes[0]} y ${codes[1]}`;
  if (codes.length === 3) return `${codes[0]}, ${codes[1]} y ${codes[2]}`;

  const remaining = codes.length - 2;
  return `${codes[0]}, ${codes[1]} y ${remaining} más`;
}

/**
 * 1. Admin Transit Alert Template Builder ('admin_order_alert')
 */
export interface AdminTransitAlertParams {
  driverName: string;
  orderCodesSummary: string;
  customerNamesSummary: string;
}

export function buildAdminTransitAlertComponents(params: AdminTransitAlertParams): MetaTemplateComponent[] {
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'driver_name', text: params.driverName },
        { type: 'text', parameter_name: 'order_id', text: params.orderCodesSummary },
        { type: 'text', parameter_name: 'customer_name', text: params.customerNamesSummary },
      ],
    },
  ];
}

/**
 * 2. Customer Transit Notification Template Builder ('order_in_transit')
 */
export interface CustomerTransitParams {
  storeName?: string;
  orderCodesSummary: string;
  etaText: string;
  trackingToken: string;
  headerImageUrl: string;
}

export function buildCustomerTransitComponents(params: CustomerTransitParams): MetaTemplateComponent[] {
  return [
    {
      type: 'header',
      parameters: [
        {
          type: 'image',
          image: { link: params.headerImageUrl },
        },
      ],
    },
    {
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'store_name', text: params.storeName || 'BranGo' },
        { type: 'text', parameter_name: 'order_id', text: params.orderCodesSummary },
        { type: 'text', parameter_name: 'eta', text: params.etaText },
      ],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [
        {
          type: 'text',
          text: params.trackingToken,
        },
      ],
    },
  ];
}

/**
 * 3. Warehouse Contact Transit Notification Template Builder ('order_in_transit_warehouse')
 * Designed for warehouse bay / gate supervisors who require order codes, waybill, driver unit, and tracking link.
 */
export interface WarehouseTransitParams {
  warehouseOrClientName: string;
  orderCodesWithWaybill: string;
  driverWithUnit: string;
  etaText: string;
  trackingToken: string;
  headerImageUrl: string;
}

export function buildWarehouseTransitComponents(params: WarehouseTransitParams): MetaTemplateComponent[] {
  return [
    {
      type: 'header',
      parameters: [
        {
          type: 'image',
          image: { link: params.headerImageUrl },
        },
      ],
    },
    {
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'warehouse_name', text: params.warehouseOrClientName },
        { type: 'text', parameter_name: 'order_id', text: params.orderCodesWithWaybill },
        { type: 'text', parameter_name: 'driver_name', text: params.driverWithUnit },
        { type: 'text', parameter_name: 'eta', text: params.etaText },
      ],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [
        {
          type: 'text',
          text: params.trackingToken,
        },
      ],
    },
  ];
}

/**
 * 4. Admin Delivery Completed Template Builder ('admin_order_completed')
 */
export interface AdminCompletionParams {
  orderCode: string;
  statusText: string;
  driverName: string;
  headerImageUrl: string;
}

export function buildAdminCompletionComponents(params: AdminCompletionParams): MetaTemplateComponent[] {
  return [
    {
      type: 'header',
      parameters: [
        {
          type: 'image',
          image: { link: params.headerImageUrl },
        },
      ],
    },
    {
      type: 'body',
      parameters: [
        { type: 'text', parameter_name: 'order_id', text: params.orderCode },
        { type: 'text', parameter_name: 'status', text: params.statusText },
        { type: 'text', parameter_name: 'driver_name', text: params.driverName },
      ],
    },
  ];
}
