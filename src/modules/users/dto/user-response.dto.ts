import { Expose } from 'class-transformer';

export class UserResponseDto {
  @Expose()
  id: string;

  @Expose()
  email: string;

  @Expose()
  name: string;

  @Expose()
  roleId: string;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
