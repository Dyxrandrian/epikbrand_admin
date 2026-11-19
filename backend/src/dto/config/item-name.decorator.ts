import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { normalizeName } from '../transforms.js';

export function IsItemName(maxLength: number) {
  return applyDecorators(
    Transform(normalizeName),
    IsString({ message: 'Le nom doit être un texte.' }),
    IsNotEmpty({ message: 'Le nom est obligatoire.' }),
    MaxLength(maxLength, { message: `Le nom ne peut pas dépasser ${maxLength} caractères.` }),
  );
}