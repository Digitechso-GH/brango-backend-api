import { Expose } from 'class-transformer';

export class VehicleResponseDto {
  @Expose()
  id: string;

  @Expose()
  plate: string;

  @Expose()
  model: string | null;

  @Expose()
  brand: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
