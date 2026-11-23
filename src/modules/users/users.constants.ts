export const ROLES = {
  SYS_SUPERADMIN: 'SYS_SUPERADMIN',
  SYS_ADMIN: 'SYS_ADMIN', // Gerente de Empresa
  SYS_COORDINATOR: 'SYS_COORDINATOR', // Coordinador Logístico
  SYS_OPERATOR: 'SYS_OPERATOR', // Legacy alias para Coordinador
  SYS_DRIVER: 'SYS_DRIVER',
} as const;

export const OPERATIONAL_ROLES = [
  ROLES.SYS_ADMIN,
  ROLES.SYS_COORDINATOR,
  ROLES.SYS_OPERATOR,
] as const;
