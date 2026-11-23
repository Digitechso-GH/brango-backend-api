import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { LicenseCategory } from '@prisma/client';

export class CreateDriverDto {
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @IsEmail(
    {},
    { message: 'Email must be a valid format' },
  )
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password: string;

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
