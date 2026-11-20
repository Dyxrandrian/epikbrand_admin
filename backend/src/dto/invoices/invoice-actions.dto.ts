import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { MAX_ITEMS } from './create-invoice.dto.js';
import { DateOnlyField, TextField } from './invoice-fields.js';
import { InvoiceItemDto } from './invoice-item.dto.js';

export class CreateCreditNoteDto {
  /** Par défaut : aujourd'hui. Jamais antérieure à la facture. */
  @IsOptional()
  @DateOnlyField()
  issue_date?: string;

  @IsOptional()
  @TextField('Les notes', 5000)
  notes?: string | null;

  @IsOptional()
  @TextField('Le pied de page', 1000)
  footer?: string | null;

  /** Lignes à créditer ; omis = copie de toutes les lignes de la facture. */
  @IsOptional()
  @IsArray({ message: 'items doit être une liste.' })
  @ArrayMinSize(1, { message: 'items doit contenir au moins une ligne.' })
  @ArrayMaxSize(MAX_ITEMS, { message: `Un document ne peut pas avoir plus de ${MAX_ITEMS} lignes.` })
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items?: InvoiceItemDto[];
}

export class ConvertQuoteDto {
  /** Par défaut : aujourd'hui. */
  @IsOptional()
  @DateOnlyField()
  issue_date?: string;

  /** Échéance de paiement de la facture ; à défaut, à renseigner avant l'émission. */
  @IsOptional()
  @DateOnlyField()
  due_date?: string | null;
}

export class DuplicateInvoiceDto {
  /** Par défaut : le client du document d'origine (qui doit être actif). */
  @IsOptional()
  @IsUUID('all', { message: 'client_id doit être un UUID valide.' })
  client_id?: string;

  @IsOptional()
  @DateOnlyField()
  issue_date?: string;

  /** Factures seulement. */
  @IsOptional()
  @DateOnlyField()
  due_date?: string | null;

  /** Devis seulement. */
  @IsOptional()
  @DateOnlyField()
  valid_until?: string | null;
}