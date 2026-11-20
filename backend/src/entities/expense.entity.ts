import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Check, Index } from 'typeorm';
import type { Company } from './company.entity.js';
import type { ExpenseCategory } from './expense-category.entity.js';
import type { Project } from './project.entity.js';
import type { User } from './user.entity.js';
import type { ExpenseItem } from './expense-item.entity.js';
import { ExpenseStatus, ExpenseRecurrence, PaymentMethod } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Check('chk_expense_amounts', '"amount_ttc" = "amount_ht" + "vat_amount"')
@Check('chk_expense_recurrence', '"is_recurring" = false OR "recurrence" IS NOT NULL')
@Check('chk_expense_nonnegative', '"amount_ht" >= 0 AND "vat_amount" >= 0')
@Check('chk_expense_due_date', '"due_date" IS NULL OR "due_date" >= "expense_date"')
@Check('chk_expense_payment', `("status" = 'paid' AND "paid_at" IS NOT NULL AND "payment_method" IS NOT NULL) OR ("status" <> 'paid' AND "paid_at" IS NULL AND "payment_method" IS NULL)`)
@Check('chk_expense_recurrence_value', '"is_recurring" = true OR "recurrence" IS NULL')
@Check('chk_expense_child_not_model', '"parent_expense_id" IS NULL OR "is_recurring" = false')
@Index('idx_expenses_company_date', { synchronize: false })
@Index('idx_expenses_company_status', { synchronize: false })
@Index('idx_expenses_due_open', { synchronize: false })
@Index('idx_expenses_project', { synchronize: false })
@Index('idx_expenses_category', { synchronize: false })
@Index('idx_expenses_user', { synchronize: false })
@Index('idx_expenses_parent', { synchronize: false })
@Index('idx_expenses_recurring', { synchronize: false })
@Index('uq_expenses_receipt', { synchronize: false })
@Index('idx_search_expenses', { synchronize: false })
@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ name: 'supplier_name', type: 'varchar', length: 150 })
  supplierName: string;

  @Column({ name: 'amount_ht', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  amountHt: number;

  @Column({ name: 'vat_amount', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  vatAmount: number;

  /** Contrainte SQL : amount_ttc = amount_ht + vat_amount */
  @Column({ name: 'amount_ttc', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  amountTtc: number;

  @Column({ type: 'enum', enum: ExpenseStatus, enumName: 'expense_status', default: ExpenseStatus.PENDING })
  status: ExpenseStatus;

  @Column({ name: 'is_recurring', type: 'boolean', default: false })
  isRecurring: boolean;

  /** Obligatoire si is_recurring = true */
  @Column({ type: 'enum', enum: ExpenseRecurrence, enumName: 'expense_recurrence', nullable: true })
  recurrence: ExpenseRecurrence | null;

  /** Dépense modèle d'une récurrence */
  @Column({ name: 'parent_expense_id', type: 'uuid', nullable: true })
  parentExpenseId: string | null;

  @Column({ name: 'expense_date', type: 'date', default: () => 'CURRENT_DATE' })
  expenseDate: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'paid_at', type: 'date', nullable: true })
  paidAt: string | null;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod, nullable: true })
  paymentMethod: PaymentMethod | null;

  @Column({ name: 'receipt_url', type: 'varchar', length: 255, nullable: true })
  receiptUrl: string | null;

  /** Validation d'une note de frais : NULL tant qu'elle n'a pas été validée */
  @Column({ name: 'validated_by', type: 'uuid', nullable: true })
  validatedById: string | null;

  @Column({ name: 'validated_at', type: 'timestamptz', nullable: true })
  validatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('ExpenseCategory', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category: ExpenseCategory | null;

  @ManyToOne('Project', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'validated_by' })
  validatedBy: User | null;

  @ManyToOne('Expense', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_expense_id' })
  parentExpense: Expense | null;

  @OneToMany('ExpenseItem', (item: any) => item.expense)
  items: ExpenseItem[];
}