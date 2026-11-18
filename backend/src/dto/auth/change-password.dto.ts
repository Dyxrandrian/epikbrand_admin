import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MAX_PASSWORD_LENGTH } from '../../security/auth.constants.js';
import { IsNewPassword } from './new-password.decorator.js';

export class ChangePasswordDto {
  @IsString({ message: 'Le mot de passe actuel doit être un texte.' })
  @IsNotEmpty({ message: 'Le mot de passe actuel est obligatoire.' })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: 'Mot de passe trop long.' })
  current_password: string;

  @IsNewPassword()
  new_password: string;

  /** Session à conserver (le session_id reçu à la connexion). Sinon, toutes sont révoquées. */
  @IsOptional()
  @IsUUID('all', { message: 'keep_session_id doit être un UUID valide.' })
  keep_session_id?: string;
}