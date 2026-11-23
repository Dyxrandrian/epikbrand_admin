import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Check, Index, Unique } from 'typeorm';
import type { Company } from './company.entity.js';

@Check('chk_job_run_status', `"status" IN ('running', 'succeeded', 'failed')`)
@Check('chk_job_run_trigger', `"triggered_by" IN ('schedule', 'manual')`)
@Index('idx_job_runs_company', { synchronize: false })
@Index('idx_job_runs_started', { synchronize: false })
@Unique('uq_job_run_scope', ['jobName', 'scope', 'runKey'])
@Entity('scheduled_job_runs')
export class ScheduledJobRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'job_name', type: 'varchar', length: 60 })
  jobName: string;

  /** NULL pour une tâche globale */
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  /** Identifiant de l'entreprise (texte) ou « global » : sert à l'unicité */
  @Column({ type: 'varchar', length: 40 })
  scope: string;

  /** Date locale du jour (AAAA-MM-JJ), ou manual:<uuid> pour une relance forcée */
  @Column({ name: 'run_key', type: 'varchar', length: 80 })
  runKey: string;

  @Column({ type: 'varchar', length: 10, default: 'running' })
  status: 'running' | 'succeeded' | 'failed';

  @Column({ name: 'triggered_by', type: 'varchar', length: 10, default: 'schedule' })
  triggeredBy: 'schedule' | 'manual';

  @Column({ type: 'int', default: 1 })
  attempts: number;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @ManyToOne('Company', { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company | null;
}