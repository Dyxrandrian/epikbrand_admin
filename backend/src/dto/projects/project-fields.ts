import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { normalizeName, trimToNull } from '../transforms.js';

const DEADLINE_MESSAGE = "L'échéance doit être une date valide au format AAAA-MM-JJ.";

export const ProjectTitle = () =>
  applyDecorators(
    Transform(normalizeName),
    IsString({ message: 'Le titre doit être un texte.' }),
    IsNotEmpty({ message: 'Le titre est obligatoire.' }),
    MaxLength(150, { message: 'Le titre ne peut pas dépasser 150 caractères.' }),
  );

export const ProjectDescription = () =>
  applyDecorators(
    Transform(trimToNull),
    IsString({ message: 'La description doit être un texte.' }),
    MaxLength(10000, { message: 'La description ne peut pas dépasser 10000 caractères.' }),
  );

export const ProjectBudget = () =>
  applyDecorators(
    IsNumber(
      { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
      { message: 'Le budget doit être un nombre avec au plus 2 décimales.' },
    ),
    Min(0, { message: 'Le budget ne peut pas être négatif.' }),
    Max(9_999_999_999.99, { message: 'Le budget est trop élevé.' }),
  );

export const ProjectDeadline = () =>
  applyDecorators(
    IsString({ message: DEADLINE_MESSAGE }),
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DEADLINE_MESSAGE }),
    IsISO8601({ strict: true }, { message: DEADLINE_MESSAGE }),
  );