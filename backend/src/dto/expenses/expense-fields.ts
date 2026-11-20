import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { normalizeName } from '../transforms.js';

export const ExpenseTitle = () =>
  applyDecorators(
    Transform(normalizeName),
    IsString({ message: 'Le titre doit être un texte.' }),
    IsNotEmpty({ message: 'Le titre est obligatoire.' }),
    MaxLength(150, { message: 'Le titre ne peut pas dépasser 150 caractères.' }),
  );

export const SupplierName = () =>
  applyDecorators(
    Transform(normalizeName),
    IsString({ message: 'Le fournisseur doit être un texte.' }),
    IsNotEmpty({ message: 'Le fournisseur est obligatoire.' }),
    MaxLength(150, { message: 'Le fournisseur ne peut pas dépasser 150 caractères.' }),
  );