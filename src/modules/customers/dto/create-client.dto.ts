import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateClientDto {
  @IsString({ message: 'El nombre del cliente debe ser un texto' })
  @IsNotEmpty({ message: 'El nombre del cliente es obligatorio' })
  nombre: string;

  @IsUUID('all', { message: 'El ID de la empresa debe ser un UUID válido' })
  @IsNotEmpty({ message: 'La empresa asociada es obligatoria' })
  empresaId: string;
}
