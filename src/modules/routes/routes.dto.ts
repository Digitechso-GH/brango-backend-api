import { IsArray, IsNotEmpty, IsString, IsUUID, ValidateNested, IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RouteStatus } from '@prisma/client';

export class RouteAssignmentInput {
  @IsUUID()
  @IsNotEmpty()
  orderId: string;
}

export class CreateRouteDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsUUID()
  @IsNotEmpty()
  driverId: string;

  @IsString()
  @IsNotEmpty()
  date: string; // Formato YYYY-MM-DD

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RouteAssignmentInput)
  assignments?: RouteAssignmentInput[];

  @IsString()
  @IsOptional()
  overviewPolyline?: string;
}

export class GetRoutesQueryDto {
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsEnum(RouteStatus)
  status?: RouteStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
