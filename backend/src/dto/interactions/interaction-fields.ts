import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { InteractionType } from '../../enums/app.enums.js';
import { trim } from '../transforms.js';

export const InteractionTypeField = () =>
  IsEnum(InteractionType, {
    message: `Le type doit être l'un de : ${Object.values(InteractionType).join(', ')}.`,
  });

export const InteractionSummaryField = () =>
  applyDecorators(
    Transform(trim),
    IsString({ message: 'Le résumé doit être un texte.' }),
    IsNotEmpty({ message: 'Le résumé est obligatoire.' }),
    MaxLength(5000, { message: 'Le résumé ne peut pas dépasser 5000 caractères.' }),
  );

export const InteractionDateField = () =>
  IsISO8601({ strict: true }, { message: "La date doit être au format ISO 8601 (exemple : 2026-11-18T14:30:00+03:00)." });