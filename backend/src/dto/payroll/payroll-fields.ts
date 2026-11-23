import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNumber, IsString, Matches, Max, Min } from 'class-validator';
import { MONTH_PATTERN } from '../../services/payroll/payroll-calendar.js';
import { upperCaseTrim } from '../transforms.js';

export const MonthField = () =>
  applyDecorators(
    IsString({ message: 'Le mois doit être au format AAAA-MM.' }),
    Matches(MONTH_PATTERN, { message: 'Le mois doit être au format AAAA-MM (exemple : 2026-05).' }),
  );

export const CodeField = () =>
  applyDecorators(
    Transform(upperCaseTrim),
    Matches(/^[A-Z][A-Z0-9_]{1,49}$/, {
      message: 'Le code doit commencer par une lettre majuscule (lettres, chiffres et _ ; 2 à 50 caractères).',
    }),
  );

export const RateField = (label: string) =>
  applyDecorators(
    IsNumber(
      { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 4 },
      { message: `${label} doit être un nombre avec au plus 4 décimales (0.01 = 1 %).` },
    ),
    Min(0, { message: `${label} ne peut pas être négatif.` }),
    Max(1, { message: `${label} doit être exprimé en fraction (0.2 = 20 %), maximum 1.` }),
  );