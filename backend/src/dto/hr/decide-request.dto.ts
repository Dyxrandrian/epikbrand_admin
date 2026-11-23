import { IsOptional } from 'class-validator';
import { TextField } from '../invoices/invoice-fields.js';

export class DecideRequestDto {
  /** Commentaire du valideur, joint à la notification du demandeur. */
  @IsOptional()
  @TextField('Le commentaire', 1000)
  comment?: string | null;
}