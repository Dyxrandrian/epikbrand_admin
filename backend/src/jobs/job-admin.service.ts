import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditAction, AuditEntityType } from '../enums/audit.enums.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { CompanyRepository } from '../repository/company.repository.js';
import { JobRunRepository } from '../repository/job-run.repository.js';
import type { LastRun } from '../repository/job-run.repository.js';
import type { AuthenticatedUser } from '../security/index.js';
import { AuditService } from '../services/audit/audit.service.js';
import { JobRegistry } from './job-registry.js';
import { JobRunner } from './job-runner.js';
import { localClock } from './job-time.js';
import { JobsConfig } from './jobs-config.js';
import type { CompanyJobContext } from './job.types.js';

const toRun = (run: LastRun | undefined) =>
  run
    ? {
        status: run.status,
        triggered_by: run.triggeredBy,
        attempts: run.attempts,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        result: run.result,
        error: run.error,
      }
    : null;

@Injectable()
export class JobAdminService {
  constructor(
    private readonly registry: JobRegistry,
    private readonly runner: JobRunner,
    private readonly runs: JobRunRepository,
    private readonly companies: CompanyRepository,
    private readonly config: JobsConfig,
    private readonly audit: AuditService,
  ) {}

  /** Tâches de l'entreprise de l'admin ; les tâches globales ne sont pas exposées. */
  async list(admin: AuthenticatedUser) {
    const byName = new Map(
      (await this.runs.lastRuns(admin.companyId)).map((run) => [run.jobName, run]),
    );
    return {
      enabled: this.config.enabled,
      run_at: this.config.runAt,
      jobs: this.registry.company().map((job) => ({
        name: job.name,
        description: job.description,
        last_run: toRun(byName.get(job.name)),
      })),
    };
  }

  /**
   * Lance une tâche pour l'entreprise de l'admin uniquement. Sans `force`, elle partage la
   * réservation du jour avec l'exécution planifiée : déjà faite aujourd'hui, elle est ignorée.
   */
  async run(admin: AuthenticatedUser, name: string, force: boolean) {
    const job = this.registry.findCompany(name);
    if (!job) throw new ResourceNotFoundException('Tâche planifiée');

    const company = await this.companies.getById(admin.companyId);
    const now = new Date();
    const clock = localClock(company.timezone, now);
    const ctx: CompanyJobContext = {
      companyId: company.id,
      timeZone: company.timezone,
      currency: company.defaultCurrency,
      today: clock.date,
      now,
    };

    const outcome = await this.runner.execute({
      jobName: job.name,
      companyId: company.id,
      runKey: force ? `manual:${randomUUID()}` : clock.date,
      triggeredBy: 'manual',
      run: () => job.run(ctx),
    });

    await this.audit.recordQuietly({
      action: AuditAction.RUN,
      entityType: AuditEntityType.SCHEDULED_JOB,
      companyId: admin.companyId,
      userId: admin.id,
      changes: { after: { job: job.name, force, status: outcome.status } },
    });

    switch (outcome.status) {
      case 'succeeded':
        return { job: job.name, status: 'succeeded', result: outcome.result };
      case 'failed':
        return { job: job.name, status: 'failed', error: outcome.error };
      default:
        return {
          job: job.name,
          status: 'skipped',
          message:
            "Cette tâche a déjà été exécutée aujourd'hui, ou est en cours. Ajoutez ?force=true pour la relancer.",
        };
    }
  }
}