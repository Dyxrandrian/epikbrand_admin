import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_PASSWORD_LENGTH } from '../../security/auth.constants.js';
import { normalizeEmail } from '../transforms.js';

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: "L'adresse e-mail est invalide." })
  email: string;

  @IsString({ message: 'Le mot de passe doit être un texte.' })
  @IsNotEmpty({ message: 'Le mot de passe est obligatoire.' })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: 'Mot de passe trop long.' })
  password: string;
}