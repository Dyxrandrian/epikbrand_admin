import { Transform } from 'class-transformer';
import { IsNumber, Matches, Max, Min, ValidateIf } from 'class-validator';
import { canonicalTimeZone, IsTimeZone } from '../time-zone.js';

export class UpdateCompanySettingsDto {
  @ValidateIf((o: UpdateCompanySettingsDto) => o.default_currency !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, {
    message: 'La devise doit être un code à 3 lettres (exemple : MGA, EUR, USD).',
  })
  default_currency?: string;

  @ValidateIf((o: UpdateCompanySettingsDto) => o.default_vat_rate !== undefined)
  @IsNumber(
    { maxDecimalPlaces: 4 },
    { message: 'Le taux de TVA doit être un nombre avec au plus 4 décimales (0.2 = 20 %).' },
  )
  @Min(0, { message: 'Le taux de TVA ne peut pas être négatif.' })
  @Max(1, { message: 'Le taux de TVA doit être exprimé en fraction (0.2 = 20 %), maximum 1.' })
  default_vat_rate?: number;

  @ValidateIf((o: UpdateCompanySettingsDto) => o.timezone !== undefined)
  @Transform(canonicalTimeZone)
  @IsTimeZone()
  timezone?: string;
}