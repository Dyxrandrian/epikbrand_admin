import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { UserRole } from '../../enums/app.enums.js';
import { normalizeEmail, trim, trimToNull } from '../transforms.js';

export class InviteUserDto {
  @Transform(trim)
  @IsString({ message: 'Le nom doit être un texte.' })
  @IsNotEmpty({ message: 'Le nom est obligatoire.' })
  @MaxLength(100, { message: 'Le nom ne peut pas dépasser 100 caractères.' })
  name: string;

  @Transform(normalizeEmail)
  @IsEmail({}, { message: "L'adresse e-mail est invalide." })
  @MaxLength(254, { message: "L'adresse e-mail est trop longue." })
  email: string;

  @IsEnum(UserRole, {
    message: `Le rôle doit être l'un de : ${Object.values(UserRole).join(', ')}.`,
  })
  role: UserRole;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Le poste doit être un texte.' })
  @MaxLength(100, { message: 'Le poste ne peut pas dépasser 100 caractères.' })
  job_title?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Le matricule doit être un texte.' })
  @MaxLength(50, { message: 'Le matricule ne peut pas dépasser 50 caractères.' })
  matricule?: string | null;
}