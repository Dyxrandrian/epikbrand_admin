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

  @ManyToOne('Expense', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_expense_id' })
  parentExpense: Expense | null;

  @OneToMany('ExpenseItem', (item: any) => item.expense)
  items: ExpenseItem[];
}