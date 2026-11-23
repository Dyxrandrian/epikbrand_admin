import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { API_PREFIX } from '../config/api-prefix.js';
import { FileStorage } from '../services/files/storage/file-storage.js';
import { daysAgo, deleteStorageObjects } from './job-helpers.js';
import type { CompanyJob, CompanyJobContext, JobResult } from './job.types.js';

const ORPHAN_AFTER_DAYS = 7;
const BATCH = 200;
const MAX_BATCHES = 10;

@Injectable()
export class PurgeOrphanFilesJob implements CompanyJob {
  readonly name = 'purge-orphan-files';
  readonly scope = 'company' as const;
  readonly description =
    "Supprime les justificatifs envoyés depuis plus de 7 jours qui n'ont jamais été rattachés à une dépense.";

  private readonly logger = new Logger(PurgeOrphanFilesJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: FileStorage,
  ) {}

  async run(ctx: CompanyJobContext): Promise<JobResult> {
    const cutoff = daysAgo(ctx.now, ORPHAN_AFTER_DAYS);
    let deleted = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const keys: string[] = [];

      const count = await this.dataSource.transaction(async (manager) => {
        // Un justificatif rattaché est référencé par l'URL stockée dans expenses.receipt_url
        const rows: Array<{ id: string; key: string }> = await manager.query(
          `SELECT m.id, m.file_url AS key
             FROM media_attachments m
            WHERE m.company_id = $1
              AND m.purpose = 'receipt'
              AND m.created_at < $2::timestamptz
              AND NOT EXISTS (
                    SELECT 1 FROM expenses e
                     WHERE e.company_id = m.company_id
                       AND e.receipt_url = '/' || $4::text || '/files/' || m.id::text || '/content')
            ORDER BY m.created_at ASC, m.id ASC
            LIMIT $3
            FOR UPDATE OF m SKIP LOCKED`,
          [ctx.companyId, cutoff, BATCH, API_PREFIX],
        );
        if (rows.length === 0) return 0;

        await manager.query(
          `WITH removed AS (
             DELETE FROM media_attachments
              WHERE company_id = $1 AND id = ANY($2::uuid[])
              RETURNING id)
           SELECT COUNT(*)::int AS n FROM removed`,
          [ctx.companyId, rows.map((row) => row.id)],
        );
        keys.push(...rows.map((row) => row.key));
        return rows.length;
      });

      await deleteStorageObjects(this.storage, keys, this.logger);
      deleted += count;
      if (count < BATCH) break;
    }
    return { deleted };
  }
}