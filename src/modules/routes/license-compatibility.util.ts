import { LicenseCategory, VehicleType } from '@prisma/client';

export interface LicenseCompatibilityRule {
  licenseCategory: LicenseCategory;
  allowedVehicleTypes?: VehicleType[];
  maxCapacityKg?: number;
  maxAxles?: number;
}

export interface CompatibilityResult {
  compatible: boolean;
  reason?: string;
}

/**
 * Estructura configurable de compatibilidad Licencia <-> Vehículo.
 * Por defecto no asume ni inventa equivalencias normativas: cuando el cliente
 * proporcione su matriz validada, se puede cargar vía TenantConfig
 * (`LICENSE_VEHICLE_MATRIX`) o en este mapa sin modificar la lógica de rutas.
 */
export function validateDriverVehicleCompatibility(
  driver: { licenseCategory?: LicenseCategory | null },
  vehicle: {
    plate: string;
    vehicleType?: VehicleType | null;
    capacityKg?: number | null;
    axles?: number | null;
  },
  customRules?: LicenseCompatibilityRule[] | null,
): CompatibilityResult {
  if (!customRules || customRules.length === 0 || !driver.licenseCategory) {
    return { compatible: true };
  }

  const rule = customRules.find((r) => r.licenseCategory === driver.licenseCategory);
  if (!rule) {
    return { compatible: true };
  }

  if (
    rule.allowedVehicleTypes &&
    rule.allowedVehicleTypes.length > 0 &&
    vehicle.vehicleType &&
    !rule.allowedVehicleTypes.includes(vehicle.vehicleType)
  ) {
    return {
      compatible: false,
      reason: `La licencia ${driver.licenseCategory} no es compatible con vehículos tipo ${vehicle.vehicleType} (${vehicle.plate}).`,
    };
  }

  if (
    rule.maxCapacityKg !== undefined &&
    vehicle.capacityKg !== null &&
    vehicle.capacityKg !== undefined &&
    vehicle.capacityKg > rule.maxCapacityKg
  ) {
    return {
      compatible: false,
      reason: `El vehículo ${vehicle.plate} (${vehicle.capacityKg} kg) excede el máximo permitido (${rule.maxCapacityKg} kg) para licencia ${driver.licenseCategory}.`,
    };
  }

  if (
    rule.maxAxles !== undefined &&
    vehicle.axles !== null &&
    vehicle.axles !== undefined &&
    vehicle.axles > rule.maxAxles
  ) {
    return {
      compatible: false,
      reason: `El vehículo ${vehicle.plate} (${vehicle.axles} ejes) excede los ejes permitidos (${rule.maxAxles}) para licencia ${driver.licenseCategory}.`,
    };
  }

  return { compatible: true };
}
