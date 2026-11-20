import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { DiscountType } from '../../enums/app.enums.js';
import { trim } from '../transforms.js';
import { MoneyField, TextField, VatRateField } from './invoice-fields.js';

export class InvoiceItemDto {
  @Transform(trim)
  @IsString({ message: 'La description doit être un texte.' })
  @IsNotEmpty({ message: 'La description est obligatoire.' })
  @MaxLength(2000, { message: 'La description ne peut pas dépasser 2000 caractères.' })
  description: string;

  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'La quantité doit être un nombre avec au plus 2 décimales.' },
  )
  @Min(0.01, { message: 'La quantité doit être supérieure à zéro.' })
  @Max(99_999_999.99, { message: 'La quantité est trop élevée.' })
  quantity: number;

  @IsOptional()
  @TextField("L'unité", 20)
  unit?: string | null;

  @MoneyField('Le prix unitaire')
  unit_price: number;

  /** Par défaut : le taux du document. */
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
}