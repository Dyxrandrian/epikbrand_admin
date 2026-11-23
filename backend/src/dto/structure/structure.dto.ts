import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { normalizeName, trim, trimToNull } from '../transforms.js';

export class CreateStructureElementDto {
  @IsUUID('all', { message: 'type_id doit être un UUID valide.' })
  type_id: string;

  @Transform(normalizeName)
  @IsString({ message: 'La valeur doit être un texte.' })
  @IsNotEmpty({ message: 'La valeur est obligatoire.' })
  @MaxLength(255, { message: 'La valeur ne peut pas dépasser 255 caractères.' })
  value: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'La description doit être un texte.' })
  @MaxLength(5000, { message: 'La description ne peut pas dépasser 5000 caractères.' })
  description?: string | null;
}

export class UpdateStructureElementDto {
  @ValidateIf((o: UpdateStructureElementDto) => o.type_id !== undefined)
  @IsUUID('all', { message: 'type_id doit être un UUID valide.' })
  type_id?: string;

  @ValidateIf((o: UpdateStructureElementDto) => o.value !== undefined)
  @Transform(normalizeName)
  @IsString({ message: 'La valeur doit être un texte.' })
  @IsNotEmpty({ message: 'La valeur ne peut pas être vide.' })
  @MaxLength(255, { message: 'La valeur ne peut pas dépasser 255 caractères.' })
  value?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'La description doit être un texte.' })
  @MaxLength(5000, { message: 'La description ne peut pas dépasser 5000 caractères.' })
  description?: string | null;
}

export class StructureListQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'type_id doit être un UUID valide.' })
  type_id?: string;

  /** Recherche dans la valeur et la description. */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'q doit être un texte.' })
  @MaxLength(200, { message: 'q ne peut pas dépasser 200 caractères.' })
  q?: string;
}