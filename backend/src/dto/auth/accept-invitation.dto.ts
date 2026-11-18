import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsNewPassword } from './new-password.decorator.js';

export class AcceptInvitationDto {
  @IsString({ message: 'token doit être un texte.' })
  @IsNotEmpty({ message: 'token est obligatoire.' })
  @MaxLength(200, { message: 'token invalide.' })
  token: string;

  @IsNewPassword()
  password: string;
}