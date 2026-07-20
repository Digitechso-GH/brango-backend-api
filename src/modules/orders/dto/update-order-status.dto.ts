import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { EstadoPedido } from '@prisma/client';

export class UpdateOrderStatusDto {
  @IsEnum(EstadoPedido, {
    message: 'El estado debe ser PENDING, IN_TRANSIT, DELIVERED o OBSERVED',
  })
  @IsNotEmpty({ message: 'El nuevo estado es obligatorio' })
  estado: EstadoPedido;

  @IsUUID('all', {
    message: 'El ID del usuario responsable debe ser un UUID válido',
  })
  @IsNotEmpty({ message: 'El ID del usuario responsable es obligatorio' })
  userId: string;
}
