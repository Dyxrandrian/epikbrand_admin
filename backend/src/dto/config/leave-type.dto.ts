import { IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { IsItemName } from './item-name.decorator.js';

export class CreateLeaveTypeDto {
  @IsItemName(50)
  name: string;

  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 1 },
    { message: 'Le quota annuel doit être un nombre avec au plus 1 décimale.' },
  )
  @Min(0, { message: 'Le quota annuel ne peut pas être négatif.' })
  @Max(366, { message: 'Le quota annuel ne peut pas dépasser 366 jours.' })
  default_annual_days?: number | null;
}

export class UpdateLeaveTypeDto {
  @ValidateIf((o: UpdateLeaveTypeDto) => o.name !== undefined)
  @IsItemName(50)
  name?: string;

  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 1 },
    { message: 'Le quota annuel doit être un nombre avec au plus 1 décimale.' },
  )
  @Min(0, { message: 'Le quota annuel ne peut pas être négatif.' })
  @Max(366, { message: 'Le quota annuel ne peut pas dépasser 366 jours.' })
  default_annual_days?: number | null;
}