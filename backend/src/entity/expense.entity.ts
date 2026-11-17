import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Company } from './company.entity.js';
import { ExpenseCategory } from './expense-category.entity.js';
import { Project } from './project.entity.js';
import { User } from './user.entity.js';
import { ExpenseItem } from './expense-item.entity.js';
import { ExpenseStatus } from '../enums/app.enums.js';

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

  @Column({ length: 150 })
  title: string;

  @Column({ name: 'supplier_name', length: 150 })
  supplierName: string;

  @Column({ name: 'amount_ht', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  amountHt: number;

  @Column({ name: 'amount_ttc', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  amountTtc: number;

  @Column({ name: 'vat_amount', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  vatAmount: number;

  @Column({ type: 'enum', enum: ExpenseStatus, enumName: 'expense_status', default: ExpenseStatus.PENDING })
  status: ExpenseStatus;

  @Column({ name: 'is_recurring', default: false })
  isRecurring: boolean;

  @Column({ name: 'expense_date', type: 'date', default: () => 'CURRENT_DATE' })
  expenseDate: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'receipt_url', length: 255, nullable: true })
  receiptUrl: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => ExpenseCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category: ExpenseCategory;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => ExpenseItem, (item) => item.expense, { cascade: true })
  items: ExpenseItem[];
}