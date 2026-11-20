import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, MaxLength } from 'class-validator';
import { normalizeEmail } from '../transforms.js';
import { TextField } from './invoice-fields.js';

export class SendInvoiceDto {
  /** Par défaut : l'adresse e-mail du client. */
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: "L'adresse e-mail est invalide." })
  @MaxLength(254, { message: "L'adresse e-mail est trop longue." })
  to?: string;

  /** Par défaut : « Facture FAC-2026-0001 - <entreprise> ». */
  @IsOptional()
  @TextField('Le sujet', 200)
  subject?: string | null;

  /** Paragraphe ajouté au message standard. */
  @IsOptional()
  @TextField('Le message', 2000)
  message?: string | null;
}