import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Company } from './company.entity.js';
import { Client } from './client.entity.js';
import { ProjectStatus } from '../enums/app.enums.js';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'budget_ht', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  budgetHt: number;

  @Column({ type: 'enum', enum: ProjectStatus, enumName: 'project_status', default: ProjectStatus.PENDING })
  status: ProjectStatus;

  @Column({ type: 'date', nullable: true })
  deadline: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Client, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: Client;
}