import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { daysAgo } from './job-helpers.js';
import { JobsConfig } from './jobs-config.js';
import type { CompanyJob, CompanyJobContext, JobResult } from './job.types.js';

const BATCH = 5000;
const MAX_BATCHES = 20;

@Injectable()
export class PurgeNotificationsJob implements CompanyJob {
  readonly name = 'purge-notifications';
  readonly scope = 'company' as const;
  readonly description = 'Supprime les notifications lues depuis plus de NOTIFICATION_RETENTION_DAYS jours (90 par défaut).';

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: JobsConfig,
  ) {}

  async run(ctx: CompanyJobContext): Promise<JobResult> {
    const days = this.config.notificationRetentionDays;
    if (days <= 0) return { disabled: true };

    const cutoff = daysAgo(ctx.now, days);
    let deleted = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows: Array<{ n: number }> = await this.dataSource.query(
        `WITH doomed AS (
           SELECT id FROM notifications
            WHERE company_id = $1
              AND is_read = true
              AND created_at < $2::timestamptz
              AND COALESCE(read_at, created_at) < $2::timestamptz
            ORDER BY created_at ASC, id ASC
            LIMIT $3
            FOR UPDATE SKIP LOCKED),
         removed AS (
           DELETE FROM notifications n
            USING doomed d
            WHERE n.id = d.id AND n.company_id = $1
            RETURNING n.id)
         SELECT COUNT(*)::int AS n FROM removed`,
        [ctx.companyId, cutoff, BATCH],
      );
      deleted += rows[0].n;
      if (rows[0].n < BATCH) break;
    }
    return { deleted, retention_days: days };
  }
}