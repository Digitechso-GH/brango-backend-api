import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateClientDto {
  @IsString({ message: 'Customer name must be a string' })
  @IsNotEmpty({ message: 'Customer name is required' })
  name: string;

  @IsUUID('all', { message: 'companyId must be a valid UUID' })
  @IsNotEmpty({ message: 'companyId is required' })
  companyId: string;
}
