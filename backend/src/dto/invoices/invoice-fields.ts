import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimToNull, upperCaseTrim } from '../transforms.js';

const DATE_MESSAGE = 'La date doit être au format AAAA-MM-JJ.';

export const DateOnlyField = () =>
  applyDecorators(
    IsString({ message: DATE_MESSAGE }),
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DATE_MESSAGE }),
    IsISO8601({ strict: true }, { message: DATE_MESSAGE }),
  );

export const CurrencyField = () =>
  applyDecorators(
    Transform(upperCaseTrim),
    Matches(/^[A-Z]{3}$/, { message: 'La devise doit être un code à 3 lettres (exemple : MGA).' }),
  );

export const VatRateField = () =>
  applyDecorators(
    IsNumber(
      { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 4 },
      { message: 'Le taux de TVA doit être un nombre avec au plus 4 décimales (0.2 = 20 %).' },
    ),
    Min(0, { message: 'Le taux de TVA ne peut pas être négatif.' }),
    Max(1, { message: 'Le taux de TVA doit être exprimé en fraction (0.2 = 20 %), maximum 1.' }),
  );

export const MoneyField = (label: string, min = 0) =>
  applyDecorators(
    IsNumber(
      { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
      { message: `${label} doit être un nombre avec au plus 2 décimales.` },
    ),
    Min(min, { message: `${label} est trop petit.` }),
    Max(9_999_999_999.99, { message: `${label} est trop élevé.` }),
  );

export const TextField = (label: string, max: number) =>
  applyDecorators(
    Transform(trimToNull),
    IsString({ message: `${label} doit être un texte.` }),
    MaxLength(max, { message: `${label} ne peut pas dépasser ${max} caractères.` }),
  );