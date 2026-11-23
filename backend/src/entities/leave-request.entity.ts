import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Check, Index, Exclusion } from 'typeorm';
import type { Company } from './company.entity.js';
import type { User } from './user.entity.js';
import type { LeaveType } from './leave-type.entity.js';
import { RequestStatus } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';
@Check('chk_leave_slots', `(("start_date" - DATE '2000-01-01') * 2 + CASE WHEN "start_half_day" THEN 1 ELSE 0 END) <= (("end_date" - DATE '2000-01-01') * 2 + CASE WHEN "end_half_day" THEN 0 ELSE 1 END)`)
@Check('chk_leave_days', '"days_count" > 0')
@Check('chk_leave_review', `("status" = 'pending' AND "reviewed_at" IS NULL) OR ("status" IN ('approved', 'rejected') AND "reviewed_at" IS NOT NULL) OR "status" = 'cancelled'`)
@Exclusion('excl_leave_no_overlap', `USING gist ("user_id" WITH =, int4range((("start_date" - DATE '2000-01-01') * 2 + CASE WHEN "start_half_day" THEN 1 ELSE 0 END), (("end_date" - DATE '2000-01-01') * 2 + CASE WHEN "end_half_day" THEN 0 ELSE 1 END), '[]') WITH &&) WHERE ("status" IN ('pending', 'approved'))`)
@Index('idx_leave_company_status_start', { synchronize: false })
@Index('idx_leave_user_created', { synchronize: false })
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

  /** Le premier jour ne compte que l'après-midi (le matin n'est pas pris) */
  @Column({ name: 'start_half_day', type: 'boolean', default: false })
  startHalfDay: boolean;

  /** Le dernier jour ne compte que le matin (l'après-midi n'est pas pris) */
  @Column({ name: 'end_half_day', type: 'boolean', default: false })
  endHalfDay: boolean;

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