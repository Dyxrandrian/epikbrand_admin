import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { trimToNull } from '../transforms.js';
import { IsItemName } from './item-name.decorator.js';

export class CreateExpenseCategoryDto {
  @IsItemName(100)
  name: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'La description doit être un texte.' })
  @MaxLength(1000, { message: 'La description ne peut pas dépasser 1000 caractères.' })
  description?: string | null;
}

export class UpdateExpenseCategoryDto {
  @ValidateIf((o: UpdateExpenseCategoryDto) => o.name !== undefined)
  @IsItemName(100)
  name?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'La description doit être un texte.' })
  @MaxLength(1000, { message: 'La description ne peut pas dépasser 1000 caractères.' })
  description?: string | null;
}