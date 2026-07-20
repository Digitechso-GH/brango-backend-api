import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateDriverDto {
  @IsString({ message: 'El nombre debe ser un texto' })
  @IsOptional()
  nombre?: string;

  @IsEmail(
    {},
    { message: 'El correo electrónico debe tener un formato válido' },
  )
  @IsOptional()
  email?: string;

  @IsString({ message: 'La contraseña debe ser un texto' })
  @IsOptional()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password?: string;

  @IsString({ message: 'La unidad asignada debe ser un texto' })
  @IsOptional()
  unidad?: string;

  @IsString({ message: 'El teléfono debe ser un texto' })
  @IsOptional()
  telefono?: string;
}
