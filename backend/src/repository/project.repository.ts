import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { Project } from '../entities/project.entity.js';
import { ProjectStatus } from '../enums/app.enums.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { ArchivableTenantRepository } from './archivable-tenant.repository.js';
import type { ArchiveFilter } from './archivable-tenant.repository.js';
import { applyIndexedWordSearch } from './search.js';

export interface TaskStats {
  total: number;
  todo: number;
  in_progress: number;
  review: number;
  done: number;
}

export interface ProjectProfitability {
  id: string;
  title: string;
  status: string;
  budgetHt: number | null;
  invoicedHt: number;
  invoicedTtc: number;
  collectedTtc: number;
  expensesHt: number;
}

export const emptyTaskStats = (): TaskStats => ({
  total: 0,
  todo: 0,
  in_progress: 0,
  review: 0,
  done: 0,
});

export interface ProjectTeamMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  tasksCount: number;
}

export interface ProjectDeletionImpact {
  tasks: number;
  files: number;
  invoices: number;
  expenses: number;
}

export interface ProjectFilters {
  status?: ProjectStatus;
  clientId?: string;
  /** Échéance strictement avant cette date (AAAA-MM-JJ). */
  dueBefore?: string;
  /** Exclut les projets livrés. */
  openOnly?: boolean;
  dueFrom?: string;
  dueTo?: string;
  /** Ne garde que les projets où cet utilisateur est assigné à une tâche active. */
  participantId?: string;
}

@Injectable()
export class ProjectRepository extends ArchivableTenantRepository<Project> {
  protected readonly alias = 'project';
  protected readonly label = 'Projet';
  protected readonly sortableFields = {
    title: 'title',
    status: 'status',
    deadline: 'deadline',
    budget_ht: 'budgetHt',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
  };
  protected readonly defaultSort: SortOrder = { created_at: 'DESC' };

  /** include=... : nom exposé par l'API -> relation de l'entité. */
  private readonly includable = { client: 'client' } as const;

  constructor(@InjectRepository(Project) repo: Repository<Project>) {
    super(repo);
  }

  async list(
    companyId: string,
    query: PaginationQueryDto,
    archived: ArchiveFilter = 'exclude',
    filters: ProjectFilters = {},
  ) {
    const qb = this.scoped(companyId, { archived });
    this.applyIncludes(qb, query.include, this.includable);

    if (filters.status) {
      qb.andWhere('project.status = :filterStatus', { filterStatus: filters.status });
    }
    if (filters.clientId) {
      qb.andWhere('project.clientId = :filterClientId', { filterClientId: filters.clientId });
    }
    if (filters.dueBefore) {
      qb.andWhere('project.deadline < :dueBefore', { dueBefore: filters.dueBefore });
    }
    if (filters.openOnly) {
      qb.andWhere('project.status <> :deliveredStatus', {
        deliveredStatus: ProjectStatus.DELIVERED,
      });
    }
    if (filters.dueFrom) {
      qb.andWhere('project.deadline >= :dueFrom', { dueFrom: filters.dueFrom });
    }
    if (filters.dueTo) {
      qb.andWhere('project.deadline <= :dueTo', { dueTo: filters.dueTo });
    }
    if (filters.participantId) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM tasks t
             JOIN task_assignees ta ON ta.task_id = t.id
            WHERE t.company_id = "project"."company_id"
              AND t.project_id = "project"."id"
              AND t.archived_at IS NULL
              AND ta.user_id = :participantId)`,
        { participantId: filters.participantId },
      );
    }

    // Même colonne que l'index idx_search_projects (PostSchema)
    applyIndexedWordSearch(qb, '"project"."title"', query.q);
    return this.paginate(qb, query);
  }

  /** Projet avec son client (id et nom seulement), pour la fiche projet. */
  async getWithClient(
    companyId: string,
    id: string,
    options: { includeArchived: boolean },
  ): Promise<Project> {
    const project = await this.scoped(companyId, {
      archived: options.includeArchived ? 'include' : 'exclude',
    })
      .leftJoin('project.client', 'inc_client')
      .addSelect(['inc_client.id', 'inc_client.companyName'])
      .andWhere('project.id = :id', { id })
      .getOne();
    if (!project) throw new ResourceNotFoundException(this.label);
    return project;
  }

  /** Verrouille la ligne jusqu'à la fin de la transaction (via withManager()). */
  async lockById(companyId: string, id: string): Promise<Project> {
    const project = await this.scoped(companyId, { archived: 'include' })
      .andWhere('project.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!project) throw new ResourceNotFoundException(this.label);
    return project;
  }

  /** Projets actifs d'un client (fiche client 360°), du plus récent au plus ancien. */
  findByClient(companyId: string, clientId: string, limit: number): Promise<Project[]> {
    return this.scoped(companyId)
      .andWhere('project.clientId = :clientId', { clientId })
      .orderBy('project.createdAt', 'DESC')
      .addOrderBy('project.id', 'ASC')
      .take(limit)
      .getMany();
  }

  countByClient(companyId: string, clientId: string): Promise<number> {
    return this.scoped(companyId).andWhere('project.clientId = :clientId', { clientId }).getCount();
  }

  /** Tâches actives par statut, pour plusieurs projets à la fois (une seule requête). */
  async taskStats(
    companyId: string,
    projectIds: readonly string[],
  ): Promise<Map<string, TaskStats>> {
    const stats = new Map<string, TaskStats>();
    if (projectIds.length === 0) return stats;

    const rows: Array<{ project_id: string; status: string; n: number }> =
      await this.repo.manager.query(
        `SELECT project_id, status, COUNT(*)::int AS n
           FROM tasks
          WHERE company_id = $1 AND project_id = ANY($2::uuid[]) AND archived_at IS NULL
          GROUP BY project_id, status`,
        [companyId, [...projectIds]],
      );

    for (const row of rows) {
      const entry = stats.get(row.project_id) ?? emptyTaskStats();
      entry[row.status as Exclude<keyof TaskStats, 'total'>] += row.n;
      entry.total += row.n;
      stats.set(row.project_id, entry);
    }
    return stats;
  }

  /** Équipe déduite des assignations sur les tâches actives du projet. */
  async team(companyId: string, projectId: string): Promise<ProjectTeamMember[]> {
    return this.repo.manager.query(
      `SELECT u.id,
              u.name,
              u.avatar_url AS "avatarUrl",
              u.job_title  AS "jobTitle",
              COUNT(*)::int AS "tasksCount"
         FROM task_assignees ta
         JOIN tasks t ON t.id = ta.task_id
         JOIN users u ON u.id = ta.user_id
        WHERE t.company_id = $1
          AND t.project_id = $2
          AND t.archived_at IS NULL
          AND u.company_id = $1
        GROUP BY u.id, u.name, u.avatar_url, u.job_title
        ORDER BY u.name ASC, u.id ASC`,
      [companyId, projectId],
    );
  }

  async isParticipant(companyId: string, projectId: string, userId: string): Promise<boolean> {
    const rows: Array<{ participant: boolean }> = await this.repo.manager.query(
      `SELECT EXISTS (
         SELECT 1
           FROM tasks t
           JOIN task_assignees ta ON ta.task_id = t.id
          WHERE t.company_id = $1
            AND t.project_id = $2
            AND t.archived_at IS NULL
            AND ta.user_id = $3
       ) AS participant`,
      [companyId, projectId, userId],
    );
    return rows[0].participant;
  }

  /** Ce que la suppression définitive effacerait ou détacherait. */
  async deletionImpact(companyId: string, projectId: string): Promise<ProjectDeletionImpact> {
    const rows: ProjectDeletionImpact[] = await this.repo.manager.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tasks
            WHERE company_id = $1 AND project_id = $2) AS tasks,
         (SELECT COUNT(*)::int FROM media_attachments
            WHERE company_id = $1
              AND (project_id = $2
                   OR task_id IN (SELECT id FROM tasks WHERE company_id = $1 AND project_id = $2))) AS files,
         (SELECT COUNT(*)::int FROM invoices
            WHERE company_id = $1 AND project_id = $2) AS invoices,
         (SELECT COUNT(*)::int FROM expenses
            WHERE company_id = $1 AND project_id = $2) AS expenses`,
      [companyId, projectId],
    );
    return rows[0];
  }

  /**
 * Budget, facturé (factures moins avoirs), encaissé et dépenses d'un ou plusieurs projets, dans la
 * devise de l'entreprise. Sans `ids`, seuls les projets qui ont une activité financière sont listés.
 */
  async profitability(
    companyId: string,
    currency: string,
    options: { ids?: string[]; includeArchived: boolean; limit: number },
  ): Promise<ProjectProfitability[]> {
    const rows: Array<Record<string, string>> = await this.repo.manager.query(
      `SELECT * FROM (
         SELECT p.id, p.title, p.status::text AS status, p.budget_ht::text AS budget,
                COALESCE((SELECT SUM(CASE WHEN i.type = 'invoice' THEN i.total_ht ELSE -i.total_ht END)
                            FROM invoices i
                           WHERE i.company_id = p.company_id AND i.project_id = p.id
                             AND i.type IN ('invoice', 'credit_note') AND i.status IN ('sent', 'overdue', 'paid')
                             AND i.currency = $2), 0)::text AS invoiced_ht,
                COALESCE((SELECT SUM(CASE WHEN i.type = 'invoice' THEN i.total_ttc ELSE -i.total_ttc END)
                            FROM invoices i
                           WHERE i.company_id = p.company_id AND i.project_id = p.id
                             AND i.type IN ('invoice', 'credit_note') AND i.status IN ('sent', 'overdue', 'paid')
                             AND i.currency = $2), 0)::text AS invoiced_ttc,
                COALESCE((SELECT SUM(pay.amount)
                            FROM invoice_payments pay
                            JOIN invoices i ON i.id = pay.invoice_id AND i.company_id = pay.company_id
                           WHERE pay.company_id = p.company_id AND i.project_id = p.id
                             AND i.currency = $2), 0)::text AS collected,
                COALESCE((SELECT SUM(e.amount_ht)
                            FROM expenses e
                           WHERE e.company_id = p.company_id AND e.project_id = p.id
                             AND e.status <> 'cancelled'), 0)::text AS expenses
           FROM projects p
          WHERE p.company_id = $1
            AND ($3::uuid[] IS NULL OR p.id = ANY($3::uuid[]))
            AND ($4::boolean OR p.archived_at IS NULL)
       ) x
        WHERE $3::uuid[] IS NOT NULL OR x.invoiced_ht::numeric <> 0 OR x.expenses::numeric <> 0
        ORDER BY x.invoiced_ht::numeric DESC, x.title ASC, x.id ASC
        LIMIT $5`,
      [this.requireCompanyId(companyId), currency, options.ids ?? null, options.includeArchived, options.limit],
    );

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      budgetHt: row.budget === null ? null : Number(row.budget),
      invoicedHt: Number(row.invoiced_ht),
      invoicedTtc: Number(row.invoiced_ttc),
      collectedTtc: Number(row.collected),
      expensesHt: Number(row.expenses),
    }));
  }

  /**
   * Copie les tâches actives d'un projet vers un autre (duplication) : hiérarchie, étiquettes,
   * priorité et ordre conservés ; statut remis à « todo », sans assigné, sans dates.
   * Les deux projets appartiennent à `companyId` : le service l'a vérifié.
   */
  async copyTasks(
    companyId: string,
    fromProjectId: string,
    toProjectId: string,
    createdBy: string,
  ): Promise<number> {
    const manager = this.repo.manager;

    const source: Array<{ id: string }> = await manager.query(
      `SELECT id FROM tasks
        WHERE company_id = $1 AND project_id = $2 AND archived_at IS NULL
        ORDER BY created_at ASC, id ASC`,
      [companyId, fromProjectId],
    );
    if (source.length === 0) return 0;

    const oldIds = source.map((row) => row.id);
    const newIds = oldIds.map(() => randomUUID());

    // Une seule instruction : les clés étrangères (sous-tâches) sont vérifiées à la fin,
    // l'ordre des lignes n'a donc pas d'importance.
    const inserted: Array<{ id: string }> = await manager.query(
      `INSERT INTO tasks
         (id, company_id, project_id, parent_task_id, title, description,
          status, priority, position, created_by, version)
       SELECT m.new_id, $1::uuid, $2::uuid, pm.new_id, t.title, t.description,
              'todo'::task_status, t.priority, t.position, $3::uuid, 1
         FROM unnest($4::uuid[], $5::uuid[]) AS m(old_id, new_id)
         JOIN tasks t ON t.id = m.old_id AND t.company_id = $1::uuid
         LEFT JOIN unnest($4::uuid[], $5::uuid[]) AS pm(old_id, new_id)
                ON pm.old_id = t.parent_task_id
       RETURNING id`,
      [companyId, toProjectId, createdBy, oldIds, newIds],
    );

    await manager.query(
      `INSERT INTO task_labels (task_id, label_id)
       SELECT m.new_id, tl.label_id
         FROM unnest($1::uuid[], $2::uuid[]) AS m(old_id, new_id)
         JOIN task_labels tl ON tl.task_id = m.old_id`,
      [oldIds, newIds],
    );

    return inserted.length;
  }
}