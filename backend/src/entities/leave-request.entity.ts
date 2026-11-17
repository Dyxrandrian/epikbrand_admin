import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Check } from 'typeorm';
import type { Company } from './company.entity.js';
import type { User } from './user.entity.js';
import type { LeaveType } from './leave-type.entity.js';
import { RequestStatus } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Check('chk_leave_dates', '"end_date" >= "start_date"')
@Entity('leave_requests')
export class LeaveRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'leave_type_id', type: 'uuid' })
  leaveTypeId: string;

  /** Format YYYY-MM-DD */
  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  /** Format YYYY-MM-DD */
  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ name: 'days_count', type: 'numeric', precision: 5, scale: 1, default: 0, transformer: numericTransformer })
  daysCount: number;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'enum', enum: RequestStatus, default: RequestStatus.PENDING })
  status: RequestStatus;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedById: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'review_comment', type: 'text', nullable: true })
  reviewComment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('LeaveType', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'leave_type_id' })
  leaveType: LeaveType;

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer: User | null;
}