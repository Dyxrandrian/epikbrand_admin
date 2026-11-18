import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../../security/auth.constants.js';

export function IsNewPassword() {
  return applyDecorators(
    IsString({ message: 'Le mot de passe doit être un texte.' }),
    MinLength(MIN_PASSWORD_LENGTH, {
      message: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    }),
    MaxLength(MAX_PASSWORD_LENGTH, {
      message: `Le mot de passe ne peut pas dépasser ${MAX_PASSWORD_LENGTH} caractères.`,
    }),
  );
}