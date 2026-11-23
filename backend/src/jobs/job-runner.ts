import { Injectable, Logger } from '@nestjs/common';
import { JobRunRepository } from '../repository/job-run.repository.js';
import { errorMessage } from './job-helpers.js';
import type { JobResult, TriggeredBy } from './job.types.js';

export type RunOutcome =
  | { status: 'succeeded'; runId: string; result: JobResult }
  | { status: 'failed'; runId: string; error: string }
  | { status: 'skipped' };

@Injectable()
export class JobRunner {
  private readonly logger = new Logger('Jobs');

  constructor(private readonly runs: JobRunRepository) {}

  /** Réserve l'exécution, la lance, enregistre le résultat. Ne lève jamais d'erreur de la tâche. */
  async execute(params: {
    jobName: string;
    companyId: string | null;
    runKey: string;
    triggeredBy: TriggeredBy;
    run: () => Promise<JobResult>;
  }): Promise<RunOutcome> {
    const runId = await this.runs.claim({
      jobName: params.jobName,
      companyId: params.companyId,
      runKey: params.runKey,
      triggeredBy: params.triggeredBy,
    });
    if (!runId) return { status: 'skipped' };

    const label = params.companyId ? `${params.jobName} [${params.companyId}]` : params.jobName;
    try {
      const result = await params.run();
      await this.runs.finish(runId, result);
      this.logger.log(`${label} : terminé ${JSON.stringify(result)}`);
      return { status: 'succeeded', runId, result };
    } catch (error) {
      const message = errorMessage(error);
      this.logger.error(`${label} : échec (${message})`, error instanceof Error ? error.stack : undefined);
      await this.runs.fail(runId, message).catch(() => undefined);
      return { status: 'failed', runId, error: message };
    }
  }
}