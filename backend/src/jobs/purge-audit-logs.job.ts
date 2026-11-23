import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { daysAgo } from './job-helpers.js';
import { JobsConfig } from './jobs-config.js';
import type { CompanyJob, CompanyJobContext, JobResult } from './job.types.js';

const BATCH = 5000;
const MAX_BATCHES = 20;

@Injectable()
export class PurgeAuditLogsJob implements CompanyJob {
  readonly name = 'purge-audit-logs';
  readonly scope = 'company' as const;
  readonly description = "Supprime les lignes du journal d'audit de plus de AUDIT_RETENTION_DAYS jours (désactivé par défaut).";

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: JobsConfig,
  ) {}

  async run(ctx: CompanyJobContext): Promise<JobResult> {
    const days = this.config.auditRetentionDays;
    if (days <= 0) return { disabled: true };

    const cutoff = daysAgo(ctx.now, days);
    let deleted = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows: Array<{ n: number }> = await this.dataSource.query(
        `WITH doomed AS (
           SELECT id FROM audit_logs
            WHERE company_id = $1 AND created_at < $2::timestamptz
            ORDER BY id ASC
            LIMIT $3),
         removed AS (
           DELETE FROM audit_logs a
            USING doomed d
            WHERE a.id = d.id AND a.company_id = $1
            RETURNING a.id)
         SELECT COUNT(*)::int AS n FROM removed`,
        [ctx.companyId, cutoff, BATCH],
      );
      deleted += rows[0].n;
      if (rows[0].n < BATCH) break;
    }
    return { deleted, retention_days: days };
  }
}