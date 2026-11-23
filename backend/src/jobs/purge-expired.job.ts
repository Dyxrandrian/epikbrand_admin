import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UPLOAD_TMP_DIR } from '../controller/files/upload-options.js';
import type { GlobalJob, GlobalJobContext, JobResult } from './job.types.js';

const TEMP_FILE_MAX_AGE_MS = 24 * 3_600_000;

/**
 * Les jetons expirés depuis plus de 7 jours sont supprimés ; ceux qui ont seulement été révoqués
 * mais pas expirés restent (ils servent à détecter le rejeu d'un jeton de rafraîchissement).
 */
const QUERIES: Record<string, string> = {
  user_tokens: `DELETE FROM user_tokens WHERE expires_at < now() - interval '7 days'`,
  refresh_tokens: `DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`,
  idempotency_keys: `DELETE FROM idempotency_keys WHERE expires_at < now()`,
  job_runs: `DELETE FROM scheduled_job_runs WHERE started_at < now() - interval '90 days'`,
};

async function cleanDirectory(directory: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return 0; // dossier absent : rien à nettoyer
  }

  let removed = 0;
  for (const name of names) {
    const path = join(directory, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && Date.now() - info.mtimeMs > TEMP_FILE_MAX_AGE_MS) {
      await rm(path, { force: true });
      removed += 1;
    }
  }
  return removed;
}

@Injectable()
export class PurgeExpiredJob implements GlobalJob {
  readonly name = 'purge-expired';
  readonly scope = 'global' as const;
  readonly description =
    "Supprime les jetons et clés d'idempotence expirés, les anciens historiques d'exécution et les fichiers temporaires.";

  constructor(private readonly dataSource: DataSource) {}

  async run(_ctx: GlobalJobContext): Promise<JobResult> {
    const result: Record<string, number> = {};

    for (const [name, deletion] of Object.entries(QUERIES)) {
      // L'instruction est enveloppée pour récupérer le nombre de lignes supprimées
      const rows: Array<{ n: number }> = await this.dataSource.query(
        `WITH removed AS (${deletion} RETURNING 1) SELECT COUNT(*)::int AS n FROM removed`,
      );
      result[name] = rows[0].n;
    }

    // Fichiers temporaires de cette instance : envois interrompus et e-mails de développement
    result.temp_files =
      (await cleanDirectory(UPLOAD_TMP_DIR)) + (await cleanDirectory(join(tmpdir(), 'epikbrand-mail')));
    return result;
  }
}