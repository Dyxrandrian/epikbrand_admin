import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { Salary } from './salary.entity.js';
import { SalaryItemType } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Entity('salary_items')
export class SalaryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salary_id', type: 'uuid' })
  salaryId: string;

  @Column({ type: 'enum', enum: SalaryItemType, enumName: 'salary_item_type' })
  type: SalaryItemType;

  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  label: string;

  @Column({ name: 'base_amount', type: 'numeric', precision: 12, scale: 2, nullable: true, default: 0, transformer: numericTransformer })
  baseAmount: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 4, nullable: true, default: 0, transformer: numericTransformer })
  rate: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  amount: number;

  @ManyToOne('Salary', (salary: any) => salary.items, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'salary_id' })
  salary: Salary;
}