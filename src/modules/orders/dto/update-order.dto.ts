import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateOrderDto {
  @IsString({ message: 'La guía debe ser un texto' })
  @IsOptional()
  guia?: string;

  @IsString({ message: 'El documento del destinatario debe ser un texto' })
  @IsOptional()
  documentoDestinatario?: string;

  @IsString({ message: 'La dirección original debe ser un texto' })
  @IsOptional()
  direccionOriginal?: string;

  @IsNumber({}, { message: 'La latitud debe ser un número' })
  @IsOptional()
  latitud?: number;

  @IsNumber({}, { message: 'La longitud debe ser un número' })
  @IsOptional()
  longitud?: number;

  @IsUUID('all', { message: 'El ID del cliente debe ser un UUID válido' })
  @IsOptional()
  clienteId?: string;

  @IsUUID('all', { message: 'El ID del chofer debe ser un UUID válido' })
  @IsOptional()
  driverId?: string;
}
