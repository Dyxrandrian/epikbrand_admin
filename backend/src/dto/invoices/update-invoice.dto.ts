import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DiscountType } from '../../enums/app.enums.js';
import { MAX_ITEMS } from './create-invoice.dto.js';
import {
  CurrencyField,
  DateOnlyField,
  MoneyField,
  TextField,
  VatRateField,
} from './invoice-fields.js';
import { InvoiceItemDto } from './invoice-item.dto.js';

export class UpdateInvoiceDto {
  @IsInt({ message: 'La version doit être un entier (celle reçue lors de la lecture).' })
  @Min(1, { message: 'La version est invalide.' })
  version: number;

  @ValidateIf((o: UpdateInvoiceDto) => o.client_id !== undefined)
  @IsUUID('all', { message: 'client_id doit être un UUID valide.' })
  client_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id?: string | null;

  @ValidateIf((o: UpdateInvoiceDto) => o.issue_date !== undefined)
  @DateOnlyField()
  issue_date?: string;

  @IsOptional()
  @DateOnlyField()
  due_date?: string | null;

  @IsOptional()
  @DateOnlyField()
  valid_until?: string | null;

  @ValidateIf((o: UpdateInvoiceDto) => o.currency !== undefined)
  @CurrencyField()
  currency?: string;

  @ValidateIf((o: UpdateInvoiceDto) => o.vat_rate !== undefined)
  @VatRateField()
  vat_rate?: number;

  /** null retire la remise globale. */
  @IsOptional()
  @IsEnum(DiscountType, {
    message: `Le type de remise doit être l'un de : ${Object.values(DiscountType).join(', ')}.`,
  })
  discount_type?: DiscountType | null;

  @IsOptional()
  @MoneyField('La remise')
  discount_value?: number | null;

  @IsOptional()
  @TextField('Les notes', 5000)
  notes?: string | null;

  @IsOptional()
  @TextField('Les conditions de paiement', 2000)
  payment_terms?: string | null;

  @IsOptional()
  @TextField('Le pied de page', 1000)
  footer?: string | null;

  /** Remplace toutes les lignes (brouillon uniquement). */
  @ValidateIf((o: UpdateInvoiceDto) => o.items !== undefined)
  @IsArray({ message: 'items doit être une liste.' })
  @ArrayMaxSize(MAX_ITEMS, { message: `Un document ne peut pas avoir plus de ${MAX_ITEMS} lignes.` })
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items?: InvoiceItemDto[];
}