import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { normalizeEmail } from '../transforms.js';

export class EmailDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: "L'adresse e-mail est invalide." })
  email: string;
}