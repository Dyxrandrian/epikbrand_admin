import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Check, Exclusion, Index } from 'typeorm';
import type { Company } from './company.entity.js';
import { SalaryItemType } from '../enums/app.enums.js';
import { RuleBase, RuleType } from '../enums/payroll.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

/** Tranche d'un barème : jusqu'à `up_to` inclus (null = sans limite), au taux `rate`. */
export interface RuleBracket {
  up_to: number | null;
  rate: number;
}

@Check('chk_payroll_rule_values', `"rule_type" IN ('rate', 'fixed', 'progressive') AND ("base_kind" IS NULL OR "base_kind" IN ('base_salary', 'gross', 'taxable_income'))`)
@Check('chk_payroll_rule_shape', `("rule_type" = 'rate' AND "rate" IS NOT NULL AND "base_kind" IS NOT NULL) OR ("rule_type" = 'fixed' AND "fixed_amount" IS NOT NULL) OR ("rule_type" = 'progressive' AND "base_kind" IS NOT NULL AND jsonb_typeof("brackets") = 'array')`)
@Check('chk_payroll_rule_dates', '"effective_to" IS NULL OR "effective_to" >= "effective_from"')
@Check('chk_payroll_rule_amounts', '("rate" IS NULL OR ("rate" >= 0 AND "rate" <= 1)) AND ("fixed_amount" IS NULL OR "fixed_amount" >= 0) AND ("base_cap" IS NULL OR "base_cap" > 0) AND ("rounding_step" IS NULL OR "rounding_step" > 0) AND "family_reduction" >= 0 AND ("minimum_amount" IS NULL OR "minimum_amount" >= 0)')
@Exclusion('excl_payroll_rule_period', `USING gist ("company_id" WITH =, "code" WITH =, daterange("effective_from", "effective_to", '[]') WITH &&) WHERE ("is_active")`)
@Index('idx_payroll_rules_company', { synchronize: false })
@Entity('payroll_rules')
export class PayrollRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  /** ex. CNAPS, OSTIE, IRSA : identifie une règle à travers ses versions successives */
  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  label: string;

  @Column({ name: 'item_type', type: 'enum', enum: SalaryItemType, enumName: 'salary_item_type' })
  itemType: SalaryItemType;

  @Column({ name: 'rule_type', type: 'varchar', length: 15 })
  ruleType: RuleType;

  @Column({ name: 'base_kind', type: 'varchar', length: 15, nullable: true })
  baseKind: RuleBase | null;

  /** Fraction : 0.01 = 1 % (type « rate ») */
  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true, transformer: numericTransformer })
  rate: number | null;

  @Column({ name: 'fixed_amount', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  fixedAmount: number | null;

  /** Plafond de la base de calcul */
  @Column({ name: 'base_cap', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  baseCap: number | null;

  /** Arrondi de la base à l'inférieur (ex. 100 Ar) */
  @Column({ name: 'rounding_step', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  roundingStep: number | null;

  @Column({ type: 'jsonb', nullable: true })
  brackets: RuleBracket[] | null;

  /** Réduction par personne à charge (barème progressif) */
  @Column({ name: 'family_reduction', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  familyReduction: number;

  /** Minimum de perception : si le montant calculé est inférieur, on retient ce minimum */
  @Column({ name: 'minimum_amount', type: 'numeric', precision: 12, scale: 2, nullable: true, transformer: numericTransformer })
  minimumAmount: number | null;

  /** La retenue vient en déduction du revenu imposable (ex. CNaPS, OSTIE pour l'IRSA) */
  @Column({ name: 'reduces_taxable_income', type: 'boolean', default: false })
  reducesTaxableIncome: boolean;

  /** Ordre d'évaluation : gains d'abord, puis retenues */
  @Column({ type: 'int', default: 0 })
  position: number;

  /** Format YYYY-MM-DD */
  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}