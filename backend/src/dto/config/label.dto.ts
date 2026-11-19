import { Transform } from 'class-transformer';
import { IsOptional, Matches, ValidateIf } from 'class-validator';
import { upperCaseTrim } from '../transforms.js';
import { IsItemName } from './item-name.decorator.js';

const COLOR_MESSAGE = 'La couleur doit être au format hexadécimal #RRGGBB (exemple : #6B7280).';

export class CreateLabelDto {
  @IsItemName(50)
  name: string;

  @IsOptional()
  @Transform(upperCaseTrim)
  @Matches(/^#[0-9A-F]{6}$/, { message: COLOR_MESSAGE })
  color?: string;
}

export class UpdateLabelDto {
  @ValidateIf((o: UpdateLabelDto) => o.name !== undefined)
  @IsItemName(50)
  name?: string;

  // La couleur ne peut pas être effacée : null est refusé
  @ValidateIf((o: UpdateLabelDto) => o.color !== undefined)
  @Transform(upperCaseTrim)
  @Matches(/^#[0-9A-F]{6}$/, { message: COLOR_MESSAGE })
  color?: string;
}