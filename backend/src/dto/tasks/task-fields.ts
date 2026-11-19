import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { normalizeName, trimToNull } from '../transforms.js';

const DATE_MESSAGE =
  'La date doit être un horodatage ISO 8601 avec fuseau (exemple : 2026-11-20T17:00:00+03:00).';
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const TaskTitle = () =>
  applyDecorators(
    Transform(normalizeName),
    IsString({ message: 'Le titre doit être un texte.' }),
    IsNotEmpty({ message: 'Le titre est obligatoire.' }),
    MaxLength(150, { message: 'Le titre ne peut pas dépasser 150 caractères.' }),
  );

export const TaskDescription = () =>
  applyDecorators(
    Transform(trimToNull),
    IsString({ message: 'La description doit être un texte.' }),
    MaxLength(10000, { message: 'La description ne peut pas dépasser 10000 caractères.' }),
  );

/** Horodatage ISO 8601 avec fuseau obligatoire (une date seule serait ambiguë). */
export const TaskDateTime = () =>
  applyDecorators(
    IsString({ message: DATE_MESSAGE }),
    Matches(DATE_TIME_PATTERN, { message: DATE_MESSAGE }),
    IsISO8601({ strict: true }, { message: DATE_MESSAGE }),
  );

// Dans une URL, un "+" non encodé devient une espace : on le rétablit avant validation
const restorePlus = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim().replace(/ (\d{2}:\d{2})$/, '+$1') : value;

export const QueryDateTime = () => applyDecorators(Transform(restorePlus), TaskDateTime());

export const UuidArray = (field: string, max: number) =>
  applyDecorators(
    IsArray({ message: `${field} doit être une liste.` }),
    ArrayMaxSize(max, { message: `${field} ne peut pas contenir plus de ${max} éléments.` }),
    ArrayUnique({ message: `${field} ne doit pas contenir de doublons.` }),
    IsUUID('all', { each: true, message: `${field} doit contenir des UUID valides.` }),
  );