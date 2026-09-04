import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, ArrayMinSize } from 'class-validator';

export class GroupEvidenceDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Se requiere al menos una asignación' })
  @IsUUID('all', { each: true, message: 'Cada identificador debe ser un UUID válido' })
  assignmentIds: string[];

  @IsString()
  @IsNotEmpty({ message: 'La URL de la evidencia en S3 es obligatoria' })
  s3Url: string;

  @IsOptional()
  @IsString()
  signatureText?: string;
}
