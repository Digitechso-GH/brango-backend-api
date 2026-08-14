import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { AssignmentStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  @IsEnum(AssignmentStatus, {
    message: 'Status must be PENDING, IN_TRANSIT, DELIVERED or OBSERVED',
  })
  @IsNotEmpty({ message: 'Status is required' })
  status: AssignmentStatus;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsString()
  @IsOptional()
  reasonText?: string;
}
