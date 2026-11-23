import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { LicenseCategory } from '@prisma/client';

export class UpdateDriverDto {
  @IsString({ message: 'Name must be a string' })
  @IsOptional()
  name?: string;

  @IsEmail(
    {},
    { message: 'Email must be a valid format' },
  )
  @IsOptional()
  email?: string;

  @IsString({ message: 'Password must be a string' })
  @IsOptional()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password?: string;

  @IsString({ message: 'Phone must be a string' })
  @IsOptional()
  phone?: string;

  @IsString({ message: 'El número de licencia debe ser texto' })
  @IsOptional()
  licenseNumber?: string;

  @IsEnum(LicenseCategory, { message: 'Categoría de licencia no válida' })
  @IsOptional()
  licenseCategory?: LicenseCategory;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
