import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Check, Unique, Index } from 'typeorm';
import type { Salary } from './salary.entity.js';
import type { PayrollRule } from './payroll-rule.entity.js';
import { SalaryItemType } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Check('chk_salary_item_amounts', '"amount" >= 0 AND ("base_amount" IS NULL OR "base_amount" >= 0) AND ("rate" IS NULL OR ("rate" >= 0 AND "rate" <= 1))')
@Check('chk_salary_item_position', '"position" >= 0')
@Unique('uq_salary_item_position', ['salaryId', 'position'])
@Index('idx_salary_items_rule', { synchronize: false })
@Entity('salary_items')
export class SalaryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salary_id', type: 'uuid' })
  salaryId: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'enum', enum: SalaryItemType, enumName: 'salary_item_type' })
  type: SalaryItemType;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  label: string;

  /** Base utilisée au moment du calcul (figée) */
  @Column({ name: 'base_amount', type: 'numeric', precision: 12, scale: 2, nullable: true, default: 0, transformer: numericTransformer })
  baseAmount: number | null;

  /** Taux utilisé au moment du calcul (figé) ; vide pour un montant fixe ou un barème */
  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true, default: 0, transformer: numericTransformer })
  rate: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  amount: number;

  /** Règle d'origine (NULL si la ligne est manuelle, ou si la règle a été supprimée depuis) */
  @Column({ name: 'rule_id', type: 'uuid', nullable: true })
  ruleId: string | null;

  /** Ligne saisie à la main : seule celle-ci est reprise lors d'une génération « à partir du mois précédent » */
  @Column({ name: 'is_manual', type: 'boolean', default: true })
  isManual: boolean;

  @ManyToOne('Salary', (salary: any) => salary.items, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'salary_id' })
  salary: Salary;

  @ManyToOne('PayrollRule', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rule_id' })
  rule: PayrollRule | null;
}