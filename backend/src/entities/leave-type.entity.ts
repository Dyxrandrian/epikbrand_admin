import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import type { Company } from './company.entity.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Entity('leave_types')
@Unique(['companyId', 'name'])
export class LeaveType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ name: 'default_annual_days', type: 'numeric', precision: 5, scale: 1, nullable: true, transformer: numericTransformer })
  defaultAnnualDays: number | null;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}