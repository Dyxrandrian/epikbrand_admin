import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString({ message: 'token doit être un texte.' })
  @IsNotEmpty({ message: 'token est obligatoire.' })
  @MaxLength(200, { message: 'token invalide.' })
  token: string;
}