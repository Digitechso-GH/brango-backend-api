import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

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

  @IsString({ message: 'Unit must be a string' })
  @IsOptional()
  unit?: string;

  @IsString({ message: 'Phone must be a string' })
  @IsOptional()
  phone?: string;
}
