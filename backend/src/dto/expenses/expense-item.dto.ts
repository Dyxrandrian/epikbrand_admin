import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsString, Max, MaxLength, Min } from 'class-validator';
import { MoneyField } from '../invoices/invoice-fields.js';
import { trim } from '../transforms.js';

export class ExpenseItemDto {
  @Transform(trim)
  @IsString({ message: 'La description doit être un texte.' })
  @IsNotEmpty({ message: 'La description est obligatoire.' })
  @MaxLength(500, { message: 'La description ne peut pas dépasser 500 caractères.' })
  description: string;

  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'La quantité doit être un nombre avec au plus 2 décimales.' },
  )
  @Min(0.01, { message: 'La quantité doit être supérieure à zéro.' })
  @Max(99_999_999.99, { message: 'La quantité est trop élevée.' })
  quantity: number;

  @MoneyField('Le prix unitaire')
  unit_price: number;
}