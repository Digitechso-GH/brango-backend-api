export const REQUIRED_ORDER_FIELDS = [
  'codigo',
  'clienteId',
  'direccionOriginal',
  'documentoDestinatario',
];

export const DEFAULT_ORDER_INCLUDE = {
  originBranch: true,
  customer: { include: { company: true } },
  assignments: {
    where: { voidedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    include: {
      driver: { include: { user: true } },
      events: true,
      evidences: true,
    },
  },
};
