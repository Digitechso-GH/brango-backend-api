import { Expose, Type } from 'class-transformer';
import { UserResponseDto } from './user-response.dto';

export class DriverResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  @Type(() => UserResponseDto)
  user?: UserResponseDto;

  @Expose()
  unit: string | null;

  @Expose()
  phone: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
