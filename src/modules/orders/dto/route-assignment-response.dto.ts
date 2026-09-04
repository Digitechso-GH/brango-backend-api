import { Expose, Type } from 'class-transformer';
import { OrderResponseDto } from './order-response.dto';
import { VehicleResponseDto } from './vehicle-response.dto';

export class RouteAssignmentResponseDto {
  @Expose()
  id: string;

  @Expose()
  orderId: string;

  @Expose()
  @Type(() => OrderResponseDto)
  order?: OrderResponseDto;

  @Expose()
  driverId: string;

  @Expose()
  vehicleId: string | null;

  @Expose()
  @Type(() => VehicleResponseDto)
  vehicle?: VehicleResponseDto;

  @Expose()
  date: Date;

  @Expose()
  sequenceIndex: number;

  @Expose()
  status: string;

  @Expose()
  reasonText: string | null;

  @Expose()
  stopGroupId: string | null;

  @Expose()
  previousAssignmentId: string | null;

  @Expose()
  originLatitude: number | null;

  @Expose()
  originLongitude: number | null;

  @Expose()
  originAddress: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
