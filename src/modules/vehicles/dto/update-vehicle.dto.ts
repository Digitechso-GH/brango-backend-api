import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { VehicleType } from '@prisma/client';

export class UpdateVehicleDto {
  @IsString({ message: 'La placa debe ser texto' })
  @IsOptional()
  plate?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @Type(() => Number)
  @IsInt({ message: 'El número de ejes debe ser un entero' })
  @Min(1, { message: 'El número de ejes debe ser al menos 1' })
  @IsOptional()
  axles?: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'La capacidad de carga (kg) debe ser numérica' })
  @Min(0, { message: 'La capacidad de carga no puede ser negativa' })
  @IsOptional()
  capacityKg?: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'El volumen (m³) debe ser numérico' })
  @Min(0, { message: 'El volumen no puede ser negativo' })
  @IsOptional()
  capacityM3?: number;

  @IsEnum(VehicleType, { message: 'Tipo de vehículo no válido' })
  @IsOptional()
  vehicleType?: VehicleType;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
