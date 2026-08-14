import { Expose } from 'class-transformer';

export class OrderResponseDto {
  @Expose()
  id: string;

  @Expose()
  code: string;

  @Expose()
  waybill: string | null;

  @Expose()
  recipientCustomerType: string;

  @Expose()
  recipientDocument: string;

  @Expose()
  recipientName: string | null;

  @Expose()
  recipientPhone: string | null;

  @Expose()
  recipientEmail: string | null;

  @Expose()
  warehouseContact: string | null;

  @Expose()
  rawAddress: string;

  @Expose()
  formattedAddress: string | null;

  @Expose()
  latitude: number | null;

  @Expose()
  longitude: number | null;

  @Expose()
  geocodingStatus: string;

  @Expose()
  originBranchId: string | null;

  @Expose()
  customerId: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
