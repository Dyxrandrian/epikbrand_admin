import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  ValidateIf,
  ValidateNested,
  Max,
  Min,
} from 'class-validator';
import { SalaryItemType } from '../../enums/app.enums.js';
import { RuleBase, RuleType } from '../../enums/payroll.enums.js';
import { DateOnlyField, MoneyField } from '../invoices/invoice-fields.js';
import { IsItemName } from '../config/item-name.decorator.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { toBoolean } from '../transforms.js';
import { CodeField, RateField } from './payroll-fields.js';

const TYPE_MESSAGE = `rule_type doit être l'un de : ${Object.values(RuleType).join(', ')}.`;
const BASE_MESSAGE = `base_kind doit être l'un de : ${Object.values(RuleBase).join(', ')}.`;
const ITEM_MESSAGE = `item_type doit être l'un de : ${Object.values(SalaryItemType).join(', ')}.`;

export class RuleBracketDto {
  /** Plafond de la tranche (inclus) ; null = sans limite (dernière tranche). */
  @ValidateIf((o: RuleBracketDto) => o.up_to !== null)
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'up_to doit être un nombre ou null.' },
  )
  @Min(0.01, { message: 'up_to doit être supérieur à zéro.' })
  up_to: number | null;

  @RateField('Le taux de la tranche')
  rate: number;
}

export class CreatePayrollRuleDto {
  @CodeField()
  code: string;

  @IsItemName(255)
  label: string;

  @IsEnum(SalaryItemType, { message: ITEM_MESSAGE })
  item_type: SalaryItemType;

  @IsEnum(RuleType, { message: TYPE_MESSAGE })
  rule_type: RuleType;

  @IsOptional()
  @IsEnum(RuleBase, { message: BASE_MESSAGE })
  base_kind?: RuleBase | null;

  /** Fraction : 0.01 = 1 % (type rate). */
  @IsOptional()
  @RateField('Le taux')
  rate?: number | null;

  /** Montant fixe (type fixed). */
  @IsOptional()
  @MoneyField('Le montant fixe')
  fixed_amount?: number | null;

  /** Plafond de la base de calcul. */
  @IsOptional()
  @MoneyField('Le plafond', 0.01)
  base_cap?: number | null;

  /** Arrondi de la base à l'inférieur (ex. 100). */
  @IsOptional()
  @MoneyField("L'arrondi", 0.01)
  rounding_step?: number | null;

  /** Barème progressif : tranches croissantes, la dernière sans limite. */
  @IsOptional()
  @ArrayMaxSize(30, { message: 'Un barème ne peut pas avoir plus de 30 tranches.' })
  @ValidateNested({ each: true })
  @Type(() => RuleBracketDto)
  brackets?: RuleBracketDto[] | null;

  /** Réduction par personne à charge (barème progressif). */
  @IsOptional()
  @MoneyField('La réduction pour charge de famille')
  family_reduction?: number;

  /** Minimum de perception. */
  @IsOptional()
  @MoneyField('Le minimum de perception')
  minimum_amount?: number | null;

  /** La retenue diminue le revenu imposable (CNaPS, OSTIE pour l'IRSA). */
  @IsOptional()
  @IsBoolean({ message: 'reduces_taxable_income doit valoir true ou false.' })
  reduces_taxable_income?: boolean;

  /** Ordre d'évaluation (gains d'abord, puis retenues). */
  @IsOptional()
  @IsInt({ message: 'position doit être un entier.' })
  @Min(0, { message: 'position ne peut pas être négatif.' })
  @Max(10_000, { message: 'position est trop élevé.' })
  position?: number;

  @DateOnlyField()
  effective_from: string;

  @IsOptional()
  @DateOnlyField()
  effective_to?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'is_active doit valoir true ou false.' })
  is_active?: boolean;
}

/** Les champs sont tous facultatifs ; seuls ceux envoyés changent. */
export class UpdatePayrollRuleDto {
  @ValidateIf((o: UpdatePayrollRuleDto) => o.code !== undefined)
  @CodeField()
  code?: string;

  @ValidateIf((o: UpdatePayrollRuleDto) => o.label !== undefined)
  @IsItemName(255)
  label?: string;

  @ValidateIf((o: UpdatePayrollRuleDto) => o.item_type !== undefined)
  @IsEnum(SalaryItemType, { message: ITEM_MESSAGE })
  item_type?: SalaryItemType;

  @ValidateIf((o: UpdatePayrollRuleDto) => o.rule_type !== undefined)
  @IsEnum(RuleType, { message: TYPE_MESSAGE })
  rule_type?: RuleType;

  @IsOptional()
  @IsEnum(RuleBase, { message: BASE_MESSAGE })
  base_kind?: RuleBase | null;

  @IsOptional()
  @RateField('Le taux')
  rate?: number | null;

  @IsOptional()
  @MoneyField('Le montant fixe')
  fixed_amount?: number | null;

  @IsOptional()
  @MoneyField('Le plafond', 0.01)
  base_cap?: number | null;

  @IsOptional()
  @MoneyField("L'arrondi", 0.01)
  rounding_step?: number | null;

  @IsOptional()
  @ArrayMaxSize(30, { message: 'Un barème ne peut pas avoir plus de 30 tranches.' })
  @ValidateNested({ each: true })
  @Type(() => RuleBracketDto)
  brackets?: RuleBracketDto[] | null;

  @ValidateIf((o: UpdatePayrollRuleDto) => o.family_reduction !== undefined)
  @MoneyField('La réduction pour charge de famille')
  family_reduction?: number;

  @IsOptional()
  @MoneyField('Le minimum de perception')
  minimum_amount?: number | null;

  @ValidateIf((o: UpdatePayrollRuleDto) => o.reduces_taxable_income !== undefined)
  @IsBoolean({ message: 'reduces_taxable_income doit valoir true ou false.' })
  reduces_taxable_income?: boolean;

  @ValidateIf((o: UpdatePayrollRuleDto) => o.position !== undefined)
  @IsInt({ message: 'position doit être un entier.' })
  @Min(0, { message: 'position ne peut pas être négatif.' })
  @Max(10_000, { message: 'position est trop élevé.' })
  position?: number;

  @ValidateIf((o: UpdatePayrollRuleDto) => o.effective_from !== undefined)
  @DateOnlyField()
  effective_from?: string;

  @IsOptional()
  @DateOnlyField()
  effective_to?: string | null;

  @ValidateIf((o: UpdatePayrollRuleDto) => o.is_active !== undefined)
  @IsBoolean({ message: 'is_active doit valoir true ou false.' })
  is_active?: boolean;
}

export class PayrollRuleListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'is_active doit valoir true ou false.' })
  is_active?: boolean;

  @IsOptional()
  @IsEnum(SalaryItemType, { message: ITEM_MESSAGE })
  item_type?: SalaryItemType;
}