import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Expense } from './expense.entity.js';

@Entity('expense_items')
export class ExpenseItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'expense_id', type: 'uuid' })
  expenseId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1.00 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  unitPrice: number;

  @ManyToOne(() => Expense, (expense) => expense.items, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'expense_id' })
  expense: Expense;
}