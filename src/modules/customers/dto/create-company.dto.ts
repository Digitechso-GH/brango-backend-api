import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateCompanyDto {
  @IsString({ message: 'El nombre de la empresa debe ser un texto' })
  @IsNotEmpty({ message: 'El nombre de la empresa es obligatorio' })
  nombre: string;

  @IsString({ message: 'El RUC de la empresa debe ser un texto' })
  @IsNotEmpty({ message: 'El RUC es obligatorio' })
  @Length(11, 11, { message: 'El RUC debe tener exactamente 11 caracteres' })
  ruc: string;
}
