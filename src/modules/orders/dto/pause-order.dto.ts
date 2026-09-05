import { IsNotEmpty, IsString } from 'class-validator';

export class PauseOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'El motivo de la pausa es obligatorio' })
  reason: string;
}
