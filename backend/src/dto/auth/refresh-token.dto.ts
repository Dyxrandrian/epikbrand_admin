import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString({ message: 'refresh_token doit être un texte.' })
  @IsNotEmpty({ message: 'refresh_token est obligatoire.' })
  @MaxLength(200, { message: 'refresh_token invalide.' })
  refresh_token: string;
}