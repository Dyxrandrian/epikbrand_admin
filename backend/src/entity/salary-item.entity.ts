import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Salary } from './salary.entity.js';
import { SalaryItemType } from '../enums/app.enums.js';

@Entity('salary_items')
export class SalaryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salary_id', type: 'uuid' })
  salaryId: string;

  @Column({ type: 'enum', enum: SalaryItemType, enumName: 'salary_item_type' })
  type: SalaryItemType;

  @Column({ length: 50 })
  code: string;

  @Column({ length: 255 })
  label: string;

  @Column({ name: 'base_amount', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  baseAmount: number;

  @Column({ type: 'numeric', precision: 5, scale: 4, default: 0.0000 })
  rate: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  amount: number;

  @ManyToOne(() => Salary, (salary) => salary.items, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'salary_id' })
  salary: Salary;
}