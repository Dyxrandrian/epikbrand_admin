import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { DiscountType, InvoiceDocumentType } from '../../enums/app.enums.js';
import {
  CurrencyField,
  DateOnlyField,
  MoneyField,
  TextField,
  VatRateField,
} from './invoice-fields.js';
import { InvoiceItemDto } from './invoice-item.dto.js';

export const MAX_ITEMS = 200;

export class CreateInvoiceDto {
  @IsIn([InvoiceDocumentType.QUOTE, InvoiceDocumentType.INVOICE], {
    message: 'type doit valoir quote ou invoice (un avoir se crée depuis une facture).',
  })
  type: InvoiceDocumentType;

  @IsUUID('all', { message: 'client_id doit être un UUID valide.' })
  client_id: string;

  @IsOptional()
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id?: string | null;

  /** Par défaut : aujourd'hui (fuseau de l'entreprise). */
  @IsOptional()
  @DateOnlyField()
  issue_date?: string;

  /** Factures : échéance de paiement. */
  @IsOptional()
  @DateOnlyField()
  due_date?: string | null;

  /** Devis : fin de validité. */
  @IsOptional()
  @DateOnlyField()
  valid_until?: string | null;

  /** Par défaut : la devise de l'entreprise. */
  @IsOptional()
  @CurrencyField()
  currency?: string;

  /** Taux par défaut des lignes sans taux propre. */
  @IsOptional()
  @VatRateField()
  vat_rate?: number;

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

  @IsOptional()
  @IsArray({ message: 'items doit être une liste.' })
  @ArrayMaxSize(MAX_ITEMS, { message: `Un document ne peut pas avoir plus de ${MAX_ITEMS} lignes.` })
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items?: InvoiceItemDto[];
}