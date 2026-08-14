import { IsArray, IsNotEmpty, IsUUID } from 'class-validator';

export class ReorderAssignmentsDto {
  @IsArray()
  @IsNotEmpty({ each: true })
  @IsUUID('all', { each: true })
  routeAssignmentIds: string[];
}
