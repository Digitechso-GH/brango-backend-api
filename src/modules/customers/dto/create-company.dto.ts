import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateCompanyDto {
  @IsString({ message: 'Company name must be a string' })
  @IsNotEmpty({ message: 'Company name is required' })
  name: string;

  @IsString({ message: 'RUC must be a string' })
  @IsNotEmpty({ message: 'RUC is required' })
  @Length(11, 11, { message: 'RUC must be exactly 11 characters' })
  ruc: string;
}
