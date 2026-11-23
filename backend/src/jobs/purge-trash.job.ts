import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditAction, AuditEntityType } from '../enums/audit.enums.js';
import { AuditService } from '../services/audit/audit.service.js';
import { FileStorage } from '../services/files/storage/file-storage.js';
import { daysAgo, deleteStorageObjects } from './job-helpers.js';
import { JobsConfig } from './jobs-config.js';
import type { CompanyJob, CompanyJobContext, JobResult } from './job.types.js';

const BATCH = 200;
const MAX_BATCHES = 10;

interface Kind {
  key: 'tasks' | 'projects' | 'clients' | 'articles';
  table: string;
  /** Candidats : $1 entreprise, $2 date limite, $3 taille du lot. Doit sélectionner id, label, archivedAt. */
  candidates: string;
  /** Clés de stockage des fichiers qui partiront avec les lignes : $1 entreprise, $2 identifiants. */
  files: string | null;
  audited: AuditEntityType | null;
}

// Ordre voulu : les tâches, puis les projets (qui libèrent des clients), puis les clients, puis les articles
const KINDS: readonly Kind[] = [
  {
    key: 'tasks',
    table: 'tasks',
    candidates: `SELECT t.id, t.title AS label, t.archived_at AS "archivedAt"
                   FROM tasks t
                  WHERE t.company_id = $1 AND t.archived_at IS NOT NULL AND t.archived_at < $2::timestamptz
                  ORDER BY t.archived_at ASC, t.id ASC
                  LIMIT $3
                  FOR UPDATE OF t SKIP LOCKED`,
    files: `SELECT m.file_url AS key
              FROM media_attachments m
             WHERE m.company_id = $1
               AND (m.task_id = ANY($2::uuid[])
                    OR m.task_id IN (SELECT s.id FROM tasks s
                                      WHERE s.company_id = $1 AND s.parent_task_id = ANY($2::uuid[])))`,
    audited: null, // volume élevé, pas de journal pour les tâches
  },
  {
    key: 'projects',
    table: 'projects',
    // Jamais un projet qui a des factures ou des dépenses : ce sont des données financières
    candidates: `SELECT p.id, p.title AS label, p.archived_at AS "archivedAt"
                   FROM projects p
                  WHERE p.company_id = $1 AND p.archived_at IS NOT NULL AND p.archived_at < $2::timestamptz
                    AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.company_id = p.company_id AND i.project_id = p.id)
                    AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.company_id = p.company_id AND e.project_id = p.id)
                  ORDER BY p.archived_at ASC, p.id ASC
                  LIMIT $3
                  FOR UPDATE OF p SKIP LOCKED`,
    files: `SELECT m.file_url AS key
              FROM media_attachments m
             WHERE m.company_id = $1
               AND (m.project_id = ANY($2::uuid[])
                    OR m.task_id IN (SELECT t.id FROM tasks t
                                      WHERE t.company_id = $1 AND t.project_id = ANY($2::uuid[])))`,
    audited: AuditEntityType.PROJECT,
  },
  {
    key: 'clients',
    table: 'clients',
    // Même règle que la suppression manuelle : aucun projet, facture ni interaction
    candidates: `SELECT c.id, c.company_name AS label, c.archived_at AS "archivedAt"
                   FROM clients c
                  WHERE c.company_id = $1 AND c.archived_at IS NOT NULL AND c.archived_at < $2::timestamptz
                    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.company_id = c.company_id AND p.client_id = c.id)
                    AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.company_id = c.company_id AND i.client_id = c.id)
                    AND NOT EXISTS (SELECT 1 FROM interactions x WHERE x.company_id = c.company_id AND x.client_id = c.id)
                  ORDER BY c.archived_at ASC, c.id ASC
                  LIMIT $3
                  FOR UPDATE OF c SKIP LOCKED`,
    files: null,
    audited: AuditEntityType.CLIENT,
  },
  {
    key: 'articles',
    table: 'agency_articles',
    candidates: `SELECT a.id, a.title AS label, a.archived_at AS "archivedAt"
                   FROM agency_articles a
                  WHERE a.company_id = $1 AND a.archived_at IS NOT NULL AND a.archived_at < $2::timestamptz
                  ORDER BY a.archived_at ASC, a.id ASC
                  LIMIT $3
                  FOR UPDATE OF a SKIP LOCKED`,
    files: `SELECT m.file_url AS key
              FROM media_attachments m
             WHERE m.company_id = $1 AND m.article_id = ANY($2::uuid[])`,
    audited: AuditEntityType.ARTICLE,
  },
];

@Injectable()
export class PurgeTrashJob implements CompanyJob {
  readonly name = 'purge-trash';
  readonly scope = 'company' as const;
  readonly description =
    "Supprime ce qui est archivé depuis plus de TRASH_RETENTION_DAYS jours (30 par défaut), sauf ce qui a un historique lié (factures, dépenses, interactions).";

  private readonly logger = new Logger(PurgeTrashJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    private readonly config: JobsConfig,
  ) {}

  async run(ctx: CompanyJobContext): Promise<JobResult> {
    const days = this.config.trashRetentionDays;
    if (days <= 0) return { disabled: true };

    const cutoff = daysAgo(ctx.now, days);
    const result: Record<string, number> = {};
    for (const kind of KINDS) result[kind.key] = await this.purge(ctx, kind, cutoff);
    return { ...result, retention_days: days };
  }

  private async purge(ctx: CompanyJobContext, kind: Kind, cutoff: Date): Promise<number> {
    let total = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const keys: string[] = [];

      const count = await this.dataSource.transaction(async (manager) => {
        const rows: Array<{ id: string; label: string | null; archivedAt: Date }> =
          await manager.query(kind.candidates, [ctx.companyId, cutoff, BATCH]);
        if (rows.length === 0) return 0;
        const ids = rows.map((row) => row.id);

        if (kind.files) {
          const files: Array<{ key: string }> = await manager.query(kind.files, [ctx.companyId, ids]);
          keys.push(...files.map((file) => file.key));
        }

        // Les lignes liées (tâches d'un projet, commentaires, versions, fichiers) partent en cascade
        await manager.query(
          `WITH removed AS (
             DELETE FROM ${kind.table}
              WHERE company_id = $1 AND id = ANY($2::uuid[])
              RETURNING id)
           SELECT COUNT(*)::int AS n FROM removed`,
          [ctx.companyId, ids],
        );

        if (kind.audited) {
          for (const row of rows) {
            await this.audit.record(
              {
                action: AuditAction.DELETE,
                entityType: kind.audited,
                entityId: row.id,
                companyId: ctx.companyId,
                userId: null, // purge automatique
                changes: {
                  before: {
                    label: row.label,
                    archived_at: row.archivedAt instanceof Date ? row.archivedAt.toISOString() : row.archivedAt,
                    purged: true,
                  },
                },
              },
              manager,
            );
          }
        }
        return rows.length;
      });

      // Les objets du stockage sont supprimés seulement une fois la transaction validée
      await deleteStorageObjects(this.storage, keys, this.logger);
      total += count;
      if (count < BATCH) break;
    }
    return total;
  }
}