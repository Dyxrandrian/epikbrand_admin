import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Check, Unique } from 'typeorm';
import type { Expense } from './expense.entity.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Check('chk_expense_item_quantity', '"quantity" > 0')
@Check('chk_expense_item_price', '"unit_price" >= 0')
@Check('chk_expense_item_position', '"position" >= 0')
@Unique('uq_expense_item_position', ['expenseId', 'position'])
@Entity('expense_items')
export class ExpenseItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'expense_id', type: 'uuid' })
  expenseId: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1, transformer: numericTransformer })
  quantity: number;

  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  unitPrice: number;

  @ManyToOne('Expense', (expense: any) => expense.items, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'expense_id' })
  expense: Expense;
}