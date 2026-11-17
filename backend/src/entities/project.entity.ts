import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, VersionColumn, Index } from 'typeorm';
import type { Company } from './company.entity.js';
import type { Client } from './client.entity.js';
import type { Task } from './task.entity.js';
import { ProjectStatus } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Index('idx_search_projects', { synchronize: false })
@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'budget_ht', type: 'numeric', precision: 12, scale: 2, nullable: true, default: 0, transformer: numericTransformer })
  budgetHt: number | null;

  @Column({ type: 'enum', enum: ProjectStatus, enumName: 'project_status', default: ProjectStatus.PENDING })
  status: ProjectStatus;

  /** Format YYYY-MM-DD */
  @Column({ type: 'date', nullable: true })
  deadline: string | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('Client', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @OneToMany('Task', (task: any) => task.project)
  tasks: Task[];
}