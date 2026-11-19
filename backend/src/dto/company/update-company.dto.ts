import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { trim, trimToNull } from '../transforms.js';

export class UpdateCompanyDto {
  @ValidateIf((o: UpdateCompanyDto) => o.name !== undefined)
  @Transform(trim)
  @IsString({ message: "Le nom de l'entreprise doit être un texte." })
  @IsNotEmpty({ message: "Le nom de l'entreprise ne peut pas être vide." })
  @MaxLength(100, { message: "Le nom de l'entreprise ne peut pas dépasser 100 caractères." })
  name?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'La présentation doit être un texte.' })
  @MaxLength(5000, { message: 'La présentation ne peut pas dépasser 5000 caractères.' })
  bio?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: "L'adresse du site web est invalide (elle doit commencer par http:// ou https://)." },
  )
  @MaxLength(255, { message: "L'adresse du site web ne peut pas dépasser 255 caractères." })
  website_url?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: "L'adresse doit être un texte." })
  @MaxLength(500, { message: "L'adresse ne peut pas dépasser 500 caractères." })
  address?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Le téléphone doit être un texte.' })
  @Matches(/^[0-9+()\-.\s]{5,30}$/, { message: 'Le numéro de téléphone est invalide.' })
  phone?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Les informations fiscales doivent être un texte.' })
  @MaxLength(100, { message: 'Les informations fiscales ne peuvent pas dépasser 100 caractères.' })
  tax_info?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Le NIF doit être un texte.' })
  @MaxLength(50, { message: 'Le NIF ne peut pas dépasser 50 caractères.' })
  nif?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Le STAT doit être un texte.' })
  @MaxLength(50, { message: 'Le STAT ne peut pas dépasser 50 caractères.' })
  stat?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Le RCS doit être un texte.' })
  @MaxLength(50, { message: 'Le RCS ne peut pas dépasser 50 caractères.' })
  rcs?: string | null;
}