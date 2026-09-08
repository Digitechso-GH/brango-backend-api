import { IsNumber, IsOptional, IsString, IsUUID, IsIn, IsBoolean } from 'class-validator';

export class UpdateOrderDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  waybill?: string;

  @IsString()
  @IsUUID('all', { message: 'originBranchId must be a valid UUID' })
  @IsOptional()
  originBranchId?: string;

  @IsString()
  @IsIn(['COMPANY', 'INDIVIDUAL'])
  @IsOptional()
  recipientCustomerType?: 'COMPANY' | 'INDIVIDUAL';

  @IsString()
  @IsOptional()
  companyRuc?: string;

  @IsString()
  @IsOptional()
  companyName?: string;

  @IsUUID('all', { message: 'customerId must be a valid UUID' })
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  recipientDocument?: string;

  @IsString()
  @IsOptional()
  recipientName?: string;

  @IsString()
  @IsOptional()
  recipientPhone?: string;

  @IsString()
  @IsOptional()
  recipientEmail?: string;

  @IsString()
  @IsOptional()
  rawAddress?: string;

  @IsString()
  @IsOptional()
  formattedAddress?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsUUID('all', { message: 'driverId must be a valid UUID' })
  @IsOptional()
  driverId?: string;

  @IsBoolean()
  @IsOptional()
  removeDriver?: boolean;

  @IsString()
  @IsOptional()
  warehouseContact?: string;

  @IsOptional()
  dueDate?: string | Date;
}
