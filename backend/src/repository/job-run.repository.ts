import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScheduledJobRun } from '../entities/scheduled-job-run.entity.js';
import type { JobResult, TriggeredBy } from '../jobs/job.types.js';

export interface LastRun {
  jobName: string;
  status: string;
  triggeredBy: string;
  attempts: number;
  startedAt: Date;
  finishedAt: Date | null;
  result: JobResult | null;
  error: string | null;
}

/** Historique des exécutions. Une ligne par tâche, par entreprise (ou « global ») et par jour. */
@Injectable()
export class JobRunRepository {
  constructor(@InjectRepository(ScheduledJobRun) private readonly repo: Repository<ScheduledJobRun>) {}

  /**
   * Réserve l'exécution, en une seule instruction atomique : une seule instance peut l'obtenir.
   * Renvoie null si une autre instance l'a déjà ou l'a terminée. Une exécution « en cours »
   * depuis plus de 30 minutes (serveur tombé) et un échec vieux de plus de 15 minutes (moins de
   * 3 tentatives) peuvent être repris.
   */
  async claim(input: {
    jobName: string;
    companyId: string | null;
    runKey: string;
    triggeredBy: TriggeredBy;
  }): Promise<string | null> {
    const rows: Array<{ id: string }> = await this.repo.manager.query(
      `INSERT INTO scheduled_job_runs (job_name, company_id, scope, run_key, triggered_by, status, attempts, started_at)
       VALUES ($1, $2::uuid, $3, $4, $5, 'running', 1, now())
       ON CONFLICT (job_name, scope, run_key) DO UPDATE
          SET status = 'running',
              triggered_by = EXCLUDED.triggered_by,
              started_at = now(),
              finished_at = NULL,
              result = NULL,
              error = NULL,
              attempts = scheduled_job_runs.attempts + 1
        WHERE (scheduled_job_runs.status = 'running'
               AND scheduled_job_runs.started_at < now() - interval '30 minutes')
           OR (scheduled_job_runs.status = 'failed'
               AND scheduled_job_runs.attempts < 3
               AND scheduled_job_runs.finished_at < now() - interval '15 minutes')
       RETURNING id`,
      [input.jobName, input.companyId, input.companyId ?? 'global', input.runKey, input.triggeredBy],
    );
    return rows[0]?.id ?? null;
  }

  async finish(id: string, result: JobResult): Promise<void> {
    await this.repo.manager.query(
      `UPDATE scheduled_job_runs
          SET status = 'succeeded', finished_at = now(), result = $2::jsonb
        WHERE id = $1`,
      [id, JSON.stringify(result)],
    );
  }

  async fail(id: string, error: string): Promise<void> {
    await this.repo.manager.query(
      `UPDATE scheduled_job_runs
          SET status = 'failed', finished_at = now(), error = $2
        WHERE id = $1`,
      [id, error],
    );
  }

  /** Dernière exécution de chaque tâche pour une entreprise. */
  lastRuns(companyId: string): Promise<LastRun[]> {
    return this.repo.manager.query(
      `SELECT DISTINCT ON (job_name)
              job_name AS "jobName", status, triggered_by AS "triggeredBy", attempts,
              started_at AS "startedAt", finished_at AS "finishedAt", result, error
         FROM scheduled_job_runs
        WHERE company_id = $1
        ORDER BY job_name, started_at DESC`,
      [companyId],
    );
  }
}