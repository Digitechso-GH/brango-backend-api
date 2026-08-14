import { Expose } from 'class-transformer';

export class OrderEventResponseDto {
  @Expose()
  id: string;

  @Expose()
  routeAssignmentId: string;

  @Expose()
  type: string;

  @Expose()
  actor: string;

  @Expose()
  metadata: any;

  @Expose()
  timestamp: Date;
}
