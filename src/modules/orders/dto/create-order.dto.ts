import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateOrderDto {
  @IsString({ message: 'El código de pedido debe ser un texto' })
  @IsNotEmpty({ message: 'El código de pedido es obligatorio' })
  codigo: string;

  @IsString({ message: 'La guía debe ser un texto' })
  @IsOptional()
  guia?: string;

  @IsString({ message: 'El documento del destinatario debe ser un texto' })
  @IsNotEmpty({ message: 'El documento del destinatario es obligatorio' })
  documentoDestinatario: string;

  @IsString({ message: 'La dirección original debe ser un texto' })
  @IsNotEmpty({ message: 'La dirección de entrega es obligatoria' })
  direccionOriginal: string;

  @IsNumber({}, { message: 'La latitud debe ser un número' })
  @IsOptional()
  latitud?: number;

  @IsNumber({}, { message: 'La longitud debe ser un número' })
  @IsOptional()
  longitud?: number;

  @IsUUID('all', { message: 'El ID del cliente debe ser un UUID válido' })
  @IsNotEmpty({ message: 'El cliente es obligatorio' })
  clienteId: string;

  @IsUUID('all', { message: 'El ID del chofer debe ser un UUID válido' })
  @IsOptional()
  driverId?: string;
}
