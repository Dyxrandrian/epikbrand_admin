import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MonthField } from '../payroll/payroll-fields.js';
import { toBoolean } from '../transforms.js';

export class DashboardQueryDto {
  /** Mois affiché (AAAA-MM) ; par défaut le mois en cours. */
  @IsOptional()
  @MonthField()
  month?: string;

  /** Nombre de mois des séries (12 par défaut). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months doit être un entier.' })
  @Min(1, { message: 'months doit être au moins 1.' })
  @Max(36, { message: 'months ne peut pas dépasser 36.' })
  months?: number;

  /** true : recalcule sans passer par le cache. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'refresh doit valoir true ou false.' })
  refresh?: boolean;
}