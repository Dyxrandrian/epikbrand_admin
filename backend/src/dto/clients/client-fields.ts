import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { normalizeName, normalizeOptionalEmail, trimToNull } from '../transforms.js';

export const ClientCompanyName = () =>
  applyDecorators(
    Transform(normalizeName),
    IsString({ message: "Le nom de l'entreprise cliente doit être un texte." }),
    IsNotEmpty({ message: "Le nom de l'entreprise cliente est obligatoire." }),
    MaxLength(100, { message: "Le nom de l'entreprise cliente ne peut pas dépasser 100 caractères." }),
  );

export const ClientContactName = () =>
  applyDecorators(
    Transform(trimToNull),
    IsString({ message: 'Le nom du contact doit être un texte.' }),
    MaxLength(100, { message: 'Le nom du contact ne peut pas dépasser 100 caractères.' }),
  );

export const ClientEmail = () =>
  applyDecorators(
    Transform(normalizeOptionalEmail),
    IsEmail({}, { message: "L'adresse e-mail est invalide." }),
    MaxLength(150, { message: "L'adresse e-mail ne peut pas dépasser 150 caractères." }),
  );

export const ClientPhone = () =>
  applyDecorators(
    Transform(trimToNull),
    IsString({ message: 'Le téléphone doit être un texte.' }),
    Matches(/^[0-9+()\-.\s]{5,30}$/, { message: 'Le numéro de téléphone est invalide.' }),
  );

export const ClientAddress = () =>
  applyDecorators(
    Transform(trimToNull),
    IsString({ message: "L'adresse doit être un texte." }),
    MaxLength(500, { message: "L'adresse ne peut pas dépasser 500 caractères." }),
  );