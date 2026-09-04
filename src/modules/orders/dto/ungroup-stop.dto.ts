import { IsNotEmpty, IsUUID } from 'class-validator';

export class UngroupStopDto {
  @IsNotEmpty({ message: 'El identificador de asignación es obligatorio' })
  @IsUUID('all', { message: 'El identificador de asignación debe ser un UUID válido' })
  assignmentId: string;
}
