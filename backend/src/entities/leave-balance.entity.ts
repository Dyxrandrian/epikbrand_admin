import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index, Check } from 'typeorm';
import type { Company } from './company.entity.js';
import type { User } from './user.entity.js';
import type { LeaveType } from './leave-type.entity.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Check('chk_leave_balance_allowance', '"allowance_days" >= 0')
@Check('chk_leave_balance_year', '"year" BETWEEN 2000 AND 2100')
@Index('idx_leave_balances_company_year', { synchronize: false })
@Entity('leave_balances')
@Unique(['userId', 'leaveTypeId', 'year'])
export class LeaveBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'leave_type_id', type: 'uuid' })
  leaveTypeId: string;

  @Column({ type: 'smallint' })
  year: number;

  @Column({ name: 'allowance_days', type: 'numeric', precision: 5, scale: 1, default: 0, transformer: numericTransformer })
  allowanceDays: number;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('LeaveType', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leave_type_id' })
  leaveType: LeaveType;
}