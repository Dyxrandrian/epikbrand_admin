import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../../security/auth.constants.js';
import { normalizeEmail, trim } from '../transforms.js';

export class RegisterCompanyDto {
  @Transform(trim)
  @IsString({ message: "Le nom de l'entreprise doit être un texte." })
  @IsNotEmpty({ message: "Le nom de l'entreprise est obligatoire." })
  @MaxLength(100, { message: "Le nom de l'entreprise ne peut pas dépasser 100 caractères." })
  company_name: string;

  @Transform(trim)
  @IsString({ message: 'Le nom doit être un texte.' })
  @IsNotEmpty({ message: 'Le nom est obligatoire.' })
  @MaxLength(100, { message: 'Le nom ne peut pas dépasser 100 caractères.' })
  name: string;

  @Transform(normalizeEmail)
  @IsEmail({}, { message: "L'adresse e-mail est invalide." })
  @MaxLength(254, { message: "L'adresse e-mail est trop longue." })
  email: string;

  @IsString({ message: 'Le mot de passe doit être un texte.' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
  })
  @MaxLength(MAX_PASSWORD_LENGTH, {
    message: `Le mot de passe ne peut pas dépasser ${MAX_PASSWORD_LENGTH} caractères.`,
  })
  password: string;
}