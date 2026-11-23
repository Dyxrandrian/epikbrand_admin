import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod, SalaryItemType, SalaryStatus } from '../../enums/app.enums.js';
import { DateOnlyField, MoneyField, TextField } from '../invoices/invoice-fields.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { UuidArray } from '../tasks/task-fields.js';
import { normalizeName, splitCsv } from '../transforms.js';
import { CodeField, MonthField, RateField } from './payroll-fields.js';

export const MAX_SALARY_LINES = 50;

export class SalaryLineDto {
  @IsEnum(SalaryItemType, {
    message: `type doit être l'un de : ${Object.values(SalaryItemType).join(', ')}.`,
  })
  type: SalaryItemType;

  @CodeField()
  code: string;

  @Transform(normalizeName)
  @IsString({ message: 'Le libellé doit être un texte.' })
  @IsNotEmpty({ message: 'Le libellé est obligatoire.' })
  @MaxLength(255, { message: 'Le libellé ne peut pas dépasser 255 caractères.' })
  label: string;

  /** Facultatif : si base ET taux sont donnés, le montant doit en être le produit. */
  @IsOptional()
  @MoneyField('La base')
  base_amount?: number | null;

  @IsOptional()
  @RateField('Le taux')
  rate?: number | null;

  @MoneyField('Le montant')
  amount: number;
}

export class CreateSalaryDto {
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id: string;

  @MonthField()
  month: string;

  /** Par défaut : le salaire de base de la fiche de la personne. */
  @IsOptional()
  @MoneyField('Le salaire de base')
  base_salary?: number;

  /** Par défaut : les personnes à charge de la fiche. */
  @IsOptional()
  @IsInt({ message: 'dependents_count doit être un entier.' })
  @Min(0, { message: 'dependents_count ne peut pas être négatif.' })
  @Max(50, { message: 'dependents_count est trop élevé.' })
  dependents_count?: number;

  /** Lignes manuelles (primes, avances…) ; les règles de paie s'appliquent en plus. */
  @IsOptional()
  @IsArray({ message: 'items doit être une liste.' })
  @ArrayMaxSize(MAX_SALARY_LINES, { message: `Un bulletin ne peut pas avoir plus de ${MAX_SALARY_LINES} lignes manuelles.` })
  @ValidateNested({ each: true })
  @Type(() => SalaryLineDto)
  items?: SalaryLineDto[];

  @IsOptional()
  @TextField('Les notes', 2000)
  notes?: string | null;
}

/** Tout changement de montant recalcule toutes les lignes avec les règles en vigueur ce jour. */
export class UpdateSalaryDto {
  @IsOptional()
  @MoneyField('Le salaire de base')
  base_salary?: number;

  @IsOptional()
  @IsInt({ message: 'dependents_count doit être un entier.' })
  @Min(0, { message: 'dependents_count ne peut pas être négatif.' })
  @Max(50, { message: 'dependents_count est trop élevé.' })
  dependents_count?: number;

  /** Remplace les lignes manuelles ; les omettre les conserve. */
  @IsOptional()
  @IsArray({ message: 'items doit être une liste.' })
  @ArrayMaxSize(MAX_SALARY_LINES, { message: `Un bulletin ne peut pas avoir plus de ${MAX_SALARY_LINES} lignes manuelles.` })
  @ValidateNested({ each: true })
  @Type(() => SalaryLineDto)
  items?: SalaryLineDto[];

  @IsOptional()
  @TextField('Les notes', 2000)
  notes?: string | null;
}

export class PaySalaryDto {
  /** Par défaut : aujourd'hui. Jamais dans le futur. */
  @IsOptional()
  @DateOnlyField()
  payment_date?: string;

  @IsEnum(PaymentMethod, {
    message: `Le moyen de paiement doit être l'un de : ${Object.values(PaymentMethod).join(', ')}.`,
  })
  method: PaymentMethod;
}

export class GenerateSalariesDto {
  @MonthField()
  month: string;

  /** Par défaut : tous les utilisateurs actifs. */
  @IsOptional()
  @UuidArray('user_ids', 500)
  user_ids?: string[];

  /** true : reprend les lignes manuelles du dernier bulletin (primes récurrentes, remboursements…). */
  @IsOptional()
  @IsBoolean({ message: 'carry_manual_lines doit valoir true ou false.' })
  carry_manual_lines?: boolean;
}

export class SalaryListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @MonthField()
  month?: string;

  @IsOptional()
  @MonthField()
  from?: string;

  @IsOptional()
  @MonthField()
  to?: string;

  @IsOptional()
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id?: string;

  /** Exemple : status=pending,paid */
  @IsOptional()
  @Transform(splitCsv)
  @IsEnum(SalaryStatus, {
    each: true,
    message: `status doit contenir : ${Object.values(SalaryStatus).join(', ')}.`,
  })
  status?: SalaryStatus[];
}

export class PayrollSummaryQueryDto {
  /** Dernier mois de la fenêtre ; par défaut le mois en cours. */
  @IsOptional()
  @MonthField()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months doit être un entier.' })
  @Min(1, { message: 'months doit être au moins 1.' })
  @Max(36, { message: 'months ne peut pas dépasser 36.' })
  months?: number;
}

export class SetCompensationDto {
  /** null efface le salaire de base. */
  @IsOptional()
  @MoneyField('Le salaire de base')
  base_salary?: number | null;

  @IsOptional()
  @IsInt({ message: 'dependents_count doit être un entier.' })
  @Min(0, { message: 'dependents_count ne peut pas être négatif.' })
  @Max(50, { message: 'dependents_count est trop élevé.' })
  dependents_count?: number;
}