import { IsArray, IsNotEmpty, IsUUID, ArrayMinSize } from 'class-validator';

export class GroupStopsDto {
  @IsArray()
  @ArrayMinSize(2, { message: 'Se requieren al menos 2 asignaciones para consolidar una parada' })
  @IsUUID('all', { each: true, message: 'Cada identificador de asignación debe ser un UUID válido' })
  @IsNotEmpty({ each: true })
  assignmentIds: string[];
}
