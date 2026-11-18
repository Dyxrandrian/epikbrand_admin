import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { trim, trimToNull } from '../transforms.js';

export class UpdateProfileDto {
  // ValidateIf (et non IsOptional) : le nom ne peut jamais être vidé ni mis à null
  @ValidateIf((o: UpdateProfileDto) => o.name !== undefined)
  @Transform(trim)
  @IsString({ message: 'Le nom doit être un texte.' })
  @IsNotEmpty({ message: 'Le nom ne peut pas être vide.' })
  @MaxLength(100, { message: 'Le nom ne peut pas dépasser 100 caractères.' })
  name?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Le téléphone doit être un texte.' })
  @MaxLength(30, { message: 'Le téléphone ne peut pas dépasser 30 caractères.' })
  @Matches(/^[0-9+()\-.\s]{5,30}$/, { message: 'Le numéro de téléphone est invalide.' })
  phone?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: "L'adresse doit être un texte." })
  @MaxLength(500, { message: "L'adresse ne peut pas dépasser 500 caractères." })
  address?: string | null;
}