import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { Task } from '../entities/task.entity.js';
import { TaskPriority, TaskStatus } from '../enums/app.enums.js';
import {
  InvalidReferenceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../exceptions/index.js';
import { ArchivableTenantRepository } from './archivable-tenant.repository.js';
import type { ArchiveFilter } from './archivable-tenant.repository.js';
import { applyIndexedWordSearch } from './search.js';

const POSITION_STEP = 1000;
const MIN_POSITION_GAP = 0.000001;
const KANBAN_LIMIT = 1000;
const CALENDAR_LIMIT = 1000;
const MINE_LIMIT = 500;

export interface TaskViewer {
  id: string;
  /** Admin ou manager : voit toutes les tâches de l'entreprise. */
  privileged: boolean;
}

export interface TaskAssigneeSummary {
  id: string;
  name: string;
  avatarUrl: string | null;
}
export interface TaskLabelSummary {
  id: string;
  name: string;
  color: string;
}
export interface SubtaskStats {
  total: number;
  done: number;
}
export interface TaskExtras {
  assignees: Map<string, TaskAssigneeSummary[]>;
  labels: Map<string, TaskLabelSummary[]>;
  subtasks: Map<string, SubtaskStats>;
  comments: Map<string, number>;
}

export const emptyExtras = (): TaskExtras => ({
  assignees: new Map(),
  labels: new Map(),
  subtasks: new Map(),
  comments: new Map(),
});

export interface TaskFilters {
  projectId?: string;
  parentTaskId?: string;
  topLevel?: boolean;
  status?: TaskStatus;
  priority?: TaskPriority;
  labelId?: string;
  assigneeId?: string;
  unassigned?: boolean;
  overdue?: boolean;
  /** Dates locales AAAA-MM-JJ, interprétées dans le fuseau de l'entreprise. */
  dueFrom?: string;
  dueTo?: string;
  timeZone: string;
}

export interface KanbanFilters {
  projectId: string;
  assigneeId?: string;
  labelId?: string;
  priority?: TaskPriority;
}

export interface CalendarFilters {
  from: Date;
  to: Date;
  projectId?: string;
  assigneeId?: string;
}

@Injectable()
export class TaskRepository extends ArchivableTenantRepository<Task> {
  protected readonly alias = 'task';
  protected readonly label = 'Tâche';
  protected readonly sortableFields = {
    title: 'title',
    status: 'status',
    priority: 'priority',
    start_date: 'startDate',
    end_date: 'endDate',
    position: 'position',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
  };
  protected readonly defaultSort: SortOrder = { created_at: 'DESC' };

  constructor(@InjectRepository(Task) repo: Repository<Task>) {
    super(repo);
  }

  // ---------- Lectures ----------

  async list(
    companyId: string,
    query: PaginationQueryDto,
    viewer: TaskViewer,
    archived: ArchiveFilter,
    filters: TaskFilters,
  ) {
    const qb = this.scoped(companyId, { archived });
    this.restrictToVisible(qb, viewer);
    this.applyFilters(qb, filters);
    this.applyTaskIncludes(qb, query.include);
    // Même colonne que l'index idx_search_tasks (PostSchema)
    applyIndexedWordSearch(qb, '"task"."title"', query.q);
    return this.paginate(qb, query);
  }

  /** Une tâche (avec id et titre de son projet) ; 404 si elle n'existe pas ou n'est pas visible. */
  async getVisible(
    companyId: string,
    id: string,
    viewer: TaskViewer,
    options: { includeArchived?: boolean } = {},
  ): Promise<Task> {
    const qb = this.scoped(companyId, { archived: options.includeArchived ? 'include' : 'exclude' })
      .leftJoin('task.project', 'inc_project')
      .addSelect(['inc_project.id', 'inc_project.title'])
      .andWhere('task.id = :taskId', { taskId: id });
    this.restrictToVisible(qb, viewer);

    const task = await qb.getOne();
    if (!task) throw new ResourceNotFoundException(this.label);
    return task;
  }

  listSubtasks(companyId: string, parentId: string, viewer: TaskViewer): Promise<Task[]> {
    const qb = this.scoped(companyId).andWhere('task.parentTaskId = :parentId', { parentId });
    this.restrictToVisible(qb, viewer);
    return qb
      .orderBy('task.position', 'ASC')
      .addOrderBy('task.createdAt', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .getMany();
  }

  /** Cartes d'un tableau (tâches de premier niveau), triées par position. */
  kanban(companyId: string, viewer: TaskViewer, filters: KanbanFilters): Promise<Task[]> {
    const qb = this.scoped(companyId)
      .andWhere('task.projectId = :kbProject', { kbProject: filters.projectId })
      .andWhere('task.parentTaskId IS NULL');
    this.restrictToVisible(qb, viewer);
    this.applyAssigneeLabelPriority(qb, filters);
    return qb.orderBy('task.position', 'ASC').addOrderBy('task.id', 'ASC').limit(KANBAN_LIMIT).getMany();
  }

  /** Tâches datées qui touchent la plage [from, to], avec leur projet. */
  calendar(companyId: string, viewer: TaskViewer, filters: CalendarFilters): Promise<Task[]> {
    const qb = this.scoped(companyId)
      .leftJoin('task.project', 'inc_project')
      .addSelect(['inc_project.id', 'inc_project.title'])
      .andWhere('COALESCE("task"."start_date", "task"."end_date") <= :calTo', { calTo: filters.to })
      .andWhere('COALESCE("task"."end_date", "task"."start_date") >= :calFrom', {
        calFrom: filters.from,
      });
    this.restrictToVisible(qb, viewer);
    if (filters.projectId) {
      qb.andWhere('task.projectId = :calProject', { calProject: filters.projectId });
    }
    this.applyAssigneeLabelPriority(qb, { assigneeId: filters.assigneeId });

    return qb
      .orderBy('inc_project.title', 'ASC')
      .addOrderBy('task.startDate', 'ASC')
      .addOrderBy('task.endDate', 'ASC')
      .addOrderBy('task.id', 'ASC')
      .limit(CALENDAR_LIMIT)
      .getMany();
  }

  /** Tâches assignées à `userId` (« Mes tâches »), avec leur projet. */
  mine(companyId: string, userId: string, includeDone: boolean): Promise<Task[]> {
    const qb = this.scoped(companyId)
      .leftJoin('task.project', 'inc_project')
      .addSelect(['inc_project.id', 'inc_project.title'])
      .andWhere(
        `EXISTS (SELECT 1 FROM task_assignees m_ta WHERE m_ta.task_id = "task"."id" AND m_ta.user_id = :mineUser)`,
        { mineUser: userId },
      );
    if (!includeDone) qb.andWhere('task.status <> :mineDone', { mineDone: TaskStatus.DONE });

    return qb
      .orderBy('task.endDate', 'ASC', 'NULLS LAST')
      .addOrderBy('task.priority', 'DESC')
      .addOrderBy('task.id', 'ASC')
      .limit(MINE_LIMIT)
      .getMany();
  }

  findActiveByIds(companyId: string, ids: readonly string[]): Promise<Task[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.scoped(companyId).andWhere('task.id IN (:...bulkIds)', { bulkIds: [...ids] }).getMany();
  }

  /** Vrai si l'utilisateur est assigné à cette tâche (de l'entreprise). */
  async isAssigned(companyId: string, taskId: string, userId: string): Promise<boolean> {
    const rows: Array<{ assigned: boolean }> = await this.repo.manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
          WHERE t.company_id = $1 AND ta.task_id = $2 AND ta.user_id = $3
       ) AS assigned`,
      [companyId, taskId, userId],
    );
    return rows[0].assigned;
  }

  /** Responsables, étiquettes, sous-tâches et commentaires de plusieurs tâches (4 requêtes). */
  async extrasFor(companyId: string, taskIds: readonly string[]): Promise<TaskExtras> {
    const extras = emptyExtras();
    if (taskIds.length === 0) return extras;

    const ids = [...taskIds];
    const query = <R>(sql: string, params: unknown[]): Promise<R[]> =>
      this.repo.manager.query(sql, params);

    const [assignees, labels, subtasks, comments] = await Promise.all([
      query<{ taskId: string } & TaskAssigneeSummary>(
        `SELECT ta.task_id AS "taskId", u.id, u.name, u.avatar_url AS "avatarUrl"
           FROM task_assignees ta
           JOIN tasks t ON t.id = ta.task_id
           JOIN users u ON u.id = ta.user_id
          WHERE t.company_id = $1 AND u.company_id = $1 AND ta.task_id = ANY($2::uuid[])
          ORDER BY u.name ASC, u.id ASC`,
        [companyId, ids],
      ),
      query<{ taskId: string } & TaskLabelSummary>(
        `SELECT tl.task_id AS "taskId", l.id, l.name, l.color
           FROM task_labels tl
           JOIN tasks t ON t.id = tl.task_id
           JOIN labels l ON l.id = tl.label_id
          WHERE t.company_id = $1 AND l.company_id = $1 AND tl.task_id = ANY($2::uuid[])
          ORDER BY l.name ASC, l.id ASC`,
        [companyId, ids],
      ),
      query<{ taskId: string; total: number; done: number }>(
        `SELECT parent_task_id AS "taskId",
                COUNT(*)::int AS total,
                (COUNT(*) FILTER (WHERE status = 'done'))::int AS done
           FROM tasks
          WHERE company_id = $1 AND parent_task_id = ANY($2::uuid[]) AND archived_at IS NULL
          GROUP BY parent_task_id`,
        [companyId, ids],
      ),
      query<{ taskId: string; n: number }>(
        `SELECT task_id AS "taskId", COUNT(*)::int AS n
           FROM task_comments
          WHERE company_id = $1 AND task_id = ANY($2::uuid[])
          GROUP BY task_id`,
        [companyId, ids],
      ),
    ]);

    for (const row of assignees) {
      const list = extras.assignees.get(row.taskId) ?? [];
      list.push({ id: row.id, name: row.name, avatarUrl: row.avatarUrl });
      extras.assignees.set(row.taskId, list);
    }
    for (const row of labels) {
      const list = extras.labels.get(row.taskId) ?? [];
      list.push({ id: row.id, name: row.name, color: row.color });
      extras.labels.set(row.taskId, list);
    }
    for (const row of subtasks) extras.subtasks.set(row.taskId, { total: row.total, done: row.done });
    for (const row of comments) extras.comments.set(row.taskId, row.n);
    return extras;
  }

  // ---------- Position (Kanban) ----------

  /** Position pour placer une tâche en bas d'une colonne. */
  async nextPosition(
    companyId: string,
    projectId: string,
    parentTaskId: string | null,
    status: TaskStatus,
  ): Promise<number> {
    const rows: Array<{ max: string }> = await this.repo.manager.query(
      `SELECT COALESCE(MAX(position), 0)::text AS max
         FROM tasks
        WHERE company_id = $1 AND project_id = $2 AND status = $3 AND archived_at IS NULL
          AND parent_task_id IS NOT DISTINCT FROM $4::uuid`,
      [companyId, projectId, status, parentTaskId],
    );
    return Number(rows[0].max) + POSITION_STEP;
  }

  /**
   * Position d'une carte déplacée dans la colonne `status`, juste après `afterId`
   * (null = tout en haut). À appeler dans une transaction (verrou de colonne).
   * Si l'espace entre deux voisins est épuisé, la colonne est renumérotée.
   */
  async placeInColumn(
    companyId: string,
    task: Pick<Task, 'id' | 'projectId' | 'parentTaskId'>,
    status: TaskStatus,
    afterId: string | null,
  ): Promise<number> {
    const manager = this.repo.manager;

    // Un seul déplacement à la fois par colonne, jusqu'à la fin de la transaction
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `task-column:${task.projectId}:${status}:${task.parentTaskId ?? 'root'}`,
    ]);

    const rows: Array<{ id: string; position: string }> = await manager.query(
      `SELECT id, position::text AS position
         FROM tasks
        WHERE company_id = $1 AND project_id = $2 AND status = $3 AND archived_at IS NULL
          AND parent_task_id IS NOT DISTINCT FROM $4::uuid AND id <> $5
        ORDER BY position ASC, id ASC`,
      [companyId, task.projectId, status, task.parentTaskId, task.id],
    );
    const column = rows.map((row) => ({ id: row.id, position: Number(row.position) }));

    let index = -1;
    if (afterId) {
      index = column.findIndex((card) => card.id === afterId);
      if (index === -1) throw new InvalidReferenceException('after_task_id', 'Tâche');
    }

    const between = (): number | null => {
      const previous = index >= 0 ? column[index].position : null;
      const next = column[index + 1]?.position ?? null;
      if (previous === null && next === null) return POSITION_STEP;
      if (previous === null) return (next as number) - POSITION_STEP;
      if (next === null) return previous + POSITION_STEP;
      if (next - previous < MIN_POSITION_GAP) return null; // plus de place entre les deux
      return Number(((previous + next) / 2).toFixed(10));
    };

    let position = between();
    if (position === null) {
      await manager.query(
        `UPDATE tasks SET position = v.pos
           FROM unnest($1::uuid[], $2::numeric[]) AS v(id, pos)
          WHERE tasks.id = v.id AND tasks.company_id = $3`,
        [column.map((card) => card.id), column.map((_, i) => (i + 1) * POSITION_STEP), companyId],
      );
      column.forEach((card, i) => {
        card.position = (i + 1) * POSITION_STEP;
      });
      position = between();
    }
    if (position === null) throw new Error('Calcul de position impossible.');
    return position;
  }

  // ---------- Assignations et étiquettes ----------

  /** Lève un 422 si un identifiant n'est pas un utilisateur actif de l'entreprise. */
  async assertActiveUsers(
    companyId: string,
    userIds: readonly string[],
    field: string,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const rows: Array<{ id: string }> = await this.repo.manager.query(
      `SELECT id FROM users WHERE company_id = $1 AND is_active = true AND id = ANY($2::uuid[])`,
      [companyId, [...userIds]],
    );
    if (rows.length !== new Set(userIds).size) throw new InvalidReferenceException(field, 'Utilisateur');
  }

  /** Lève un 422 si un identifiant n'est pas une étiquette de l'entreprise. */
  async assertLabelsExist(
    companyId: string,
    labelIds: readonly string[],
    field: string,
  ): Promise<void> {
    if (labelIds.length === 0) return;
    const rows: Array<{ id: string }> = await this.repo.manager.query(
      `SELECT id FROM labels WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, [...labelIds]],
    );
    if (rows.length !== new Set(labelIds).size) throw new InvalidReferenceException(field, 'Étiquette');
  }

  /** Utilisateurs (parmi `userIds`) qui peuvent voir une tâche de ce projet : mentions. */
  async mentionableUserIds(
    companyId: string,
    projectId: string,
    userIds: readonly string[],
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows: Array<{ id: string }> = await this.repo.manager.query(
      `SELECT u.id
         FROM users u
        WHERE u.company_id = $1
          AND u.is_active = true
          AND u.id = ANY($3::uuid[])
          AND (u.role <> 'collaborator' OR EXISTS (
                SELECT 1
                  FROM tasks t
                  JOIN task_assignees ta ON ta.task_id = t.id
                  JOIN projects p ON p.id = t.project_id
                 WHERE t.company_id = $1 AND t.project_id = $2
                   AND t.archived_at IS NULL AND p.archived_at IS NULL
                   AND ta.user_id = u.id))`,
      [companyId, projectId, [...userIds]],
    );
    return rows.map((row) => row.id);
  }

  /** Ajoute des responsables ; renvoie ceux réellement ajoutés (les autres l'étaient déjà). */
  async addAssignees(taskId: string, userIds: readonly string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows: Array<{ user_id: string }> = await this.repo.manager.query(
      `INSERT INTO task_assignees (task_id, user_id)
       SELECT $1::uuid, u FROM unnest($2::uuid[]) AS u
       ON CONFLICT DO NOTHING
       RETURNING user_id`,
      [taskId, [...userIds]],
    );
    return rows.map((row) => row.user_id);
  }

  async removeAssignee(companyId: string, taskId: string, userId: string): Promise<boolean> {
    const rows: unknown[] = await this.repo.manager.query(
      `DELETE FROM task_assignees ta
        USING tasks t
        WHERE ta.task_id = t.id AND t.company_id = $1 AND ta.task_id = $2 AND ta.user_id = $3
        RETURNING ta.user_id`,
      [companyId, taskId, userId],
    );
    return rows.length > 0;
  }

  /** Remplace les responsables de plusieurs tâches. Renvoie les assignations réellement ajoutées. */
  async replaceAssignees(
    companyId: string,
    taskIds: readonly string[],
    userIds: readonly string[],
  ): Promise<Array<{ taskId: string; userId: string }>> {
    const manager = this.repo.manager;
    await manager.query(
      `DELETE FROM task_assignees ta
        USING tasks t
        WHERE ta.task_id = t.id AND t.company_id = $1 AND ta.task_id = ANY($2::uuid[])
          AND NOT (ta.user_id = ANY($3::uuid[]))`,
      [companyId, [...taskIds], [...userIds]],
    );
    const added: Array<{ task_id: string; user_id: string }> = await manager.query(
      `INSERT INTO task_assignees (task_id, user_id)
       SELECT t.id, u.id FROM unnest($1::uuid[]) AS t(id), unnest($2::uuid[]) AS u(id)
       ON CONFLICT DO NOTHING
       RETURNING task_id, user_id`,
      [[...taskIds], [...userIds]],
    );
    return added.map((row) => ({ taskId: row.task_id, userId: row.user_id }));
  }

  /** Remplace les étiquettes de plusieurs tâches (liste vide = tout retirer). */
  async replaceLabels(
    companyId: string,
    taskIds: readonly string[],
    labelIds: readonly string[],
  ): Promise<void> {
    await this.repo.manager.query(
      `DELETE FROM task_labels tl
        USING tasks t
        WHERE tl.task_id = t.id AND t.company_id = $1 AND tl.task_id = ANY($2::uuid[])
          AND NOT (tl.label_id = ANY($3::uuid[]))`,
      [companyId, [...taskIds], [...labelIds]],
    );
    await this.addLabels(taskIds, labelIds);
  }

  async addLabels(taskIds: readonly string[], labelIds: readonly string[]): Promise<void> {
    if (taskIds.length === 0 || labelIds.length === 0) return;
    await this.repo.manager.query(
      `INSERT INTO task_labels (task_id, label_id)
       SELECT t.id, l.id FROM unnest($1::uuid[]) AS t(id), unnest($2::uuid[]) AS l(id)
       ON CONFLICT DO NOTHING`,
      [[...taskIds], [...labelIds]],
    );
  }

  async removeLabels(
    companyId: string,
    taskIds: readonly string[],
    labelIds: readonly string[],
  ): Promise<void> {
    await this.repo.manager.query(
      `DELETE FROM task_labels tl
        USING tasks t
        WHERE tl.task_id = t.id AND t.company_id = $1
          AND tl.task_id = ANY($2::uuid[]) AND tl.label_id = ANY($3::uuid[])`,
      [companyId, [...taskIds], [...labelIds]],
    );
  }

  // ---------- Écritures en masse, archivage, copie ----------

  /** Archive les tâches et leurs sous-tâches actives, avec le même horodatage. */
  async archiveTrees(companyId: string, ids: readonly string[]): Promise<void> {
    await this.repo.manager.query(
      `UPDATE tasks
          SET archived_at = $3, version = version + 1, updated_at = now()
        WHERE company_id = $1 AND archived_at IS NULL
          AND (id = ANY($2::uuid[]) OR parent_task_id = ANY($2::uuid[]))`,
      [companyId, [...ids], new Date()],
    );
  }

  /** Restaure la tâche et les sous-tâches archivées en même temps qu'elle. */
  async restoreTree(companyId: string, id: string): Promise<void> {
    await this.repo.manager.query(
      `UPDATE tasks
          SET archived_at = NULL, version = version + 1, updated_at = now()
        WHERE company_id = $1 AND archived_at IS NOT NULL
          AND (id = $2
               OR (parent_task_id = $2
                   AND archived_at = (SELECT archived_at FROM tasks WHERE company_id = $1 AND id = $2)))`,
      [companyId, id],
    );
  }

  /** Changement de statut groupé : complétion mise à jour, position inchangée. */
  async bulkSetStatus(
    companyId: string,
    ids: readonly string[],
    status: TaskStatus,
  ): Promise<void> {
    await this.repo.manager.query(
      `UPDATE tasks
          SET status = $3::task_status,
              completed_at = CASE WHEN $3::task_status = 'done'
                                  THEN COALESCE(completed_at, now()) ELSE NULL END,
              version = version + 1,
              updated_at = now()
        WHERE company_id = $1 AND archived_at IS NULL
          AND id = ANY($2::uuid[]) AND status <> $3::task_status`,
      [companyId, [...ids], status],
    );
  }

  async copyLabels(companyId: string, fromTaskId: string, toTaskId: string): Promise<void> {
    await this.repo.manager.query(
      `INSERT INTO task_labels (task_id, label_id)
       SELECT $2::uuid, tl.label_id
         FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
        WHERE t.company_id = $3 AND tl.task_id = $1`,
      [fromTaskId, toTaskId, companyId],
    );
  }

  /** Copie les sous-tâches actives sous un nouveau parent : à faire, sans responsable. */
  async copySubtasks(
    companyId: string,
    fromParentId: string,
    toParentId: string,
    createdBy: string,
  ): Promise<number> {
    const manager = this.repo.manager;

    const source: Array<{ id: string }> = await manager.query(
      `SELECT id FROM tasks
        WHERE company_id = $1 AND parent_task_id = $2 AND archived_at IS NULL
        ORDER BY position ASC, id ASC`,
      [companyId, fromParentId],
    );
    if (source.length === 0) return 0;

    const oldIds = source.map((row) => row.id);
    const newIds = oldIds.map(() => randomUUID());

    await manager.query(
      `INSERT INTO tasks
         (id, company_id, project_id, parent_task_id, title, description,
          status, priority, position, start_date, end_date, created_by, version)
       SELECT m.new_id, t.company_id, t.project_id, $2::uuid, t.title, t.description,
              'todo'::task_status, t.priority, t.position, t.start_date, t.end_date, $3::uuid, 1
         FROM unnest($4::uuid[], $5::uuid[]) AS m(old_id, new_id)
         JOIN tasks t ON t.id = m.old_id AND t.company_id = $1::uuid`,
      [companyId, toParentId, createdBy, oldIds, newIds],
    );
    await manager.query(
      `INSERT INTO task_labels (task_id, label_id)
       SELECT m.new_id, tl.label_id
         FROM unnest($1::uuid[], $2::uuid[]) AS m(old_id, new_id)
         JOIN task_labels tl ON tl.task_id = m.old_id`,
      [oldIds, newIds],
    );
    return oldIds.length;
  }

  // ---------- Outils internes ----------

  /**
   * Collaborateur : tâches qui lui sont assignées, ou tâches d'un projet actif où il est
   * assigné à au moins une tâche active. Admin et manager : aucune restriction.
   */
  private restrictToVisible(qb: SelectQueryBuilder<Task>, viewer: TaskViewer): void {
    if (viewer.privileged) return;
    qb.andWhere(
      `(EXISTS (SELECT 1 FROM task_assignees v_ta
                 WHERE v_ta.task_id = "task"."id" AND v_ta.user_id = :visViewer)
        OR EXISTS (SELECT 1
                     FROM tasks v_t
                     JOIN task_assignees v_ta2 ON v_ta2.task_id = v_t.id
                     JOIN projects v_p ON v_p.id = v_t.project_id
                    WHERE v_t.company_id = "task"."company_id"
                      AND v_t.project_id = "task"."project_id"
                      AND v_t.archived_at IS NULL
                      AND v_p.archived_at IS NULL
                      AND v_ta2.user_id = :visViewer))`,
      { visViewer: viewer.id },
    );
  }

  private applyFilters(qb: SelectQueryBuilder<Task>, f: TaskFilters): void {
    if (f.projectId) qb.andWhere('task.projectId = :fProject', { fProject: f.projectId });
    if (f.parentTaskId) qb.andWhere('task.parentTaskId = :fParent', { fParent: f.parentTaskId });
    if (f.topLevel === true) qb.andWhere('task.parentTaskId IS NULL');
    if (f.topLevel === false) qb.andWhere('task.parentTaskId IS NOT NULL');
    if (f.status) qb.andWhere('task.status = :fStatus', { fStatus: f.status });
    if (f.overdue === true) {
      qb.andWhere('task.endDate < :fNow', { fNow: new Date() }).andWhere('task.status <> :fDone', {
        fDone: TaskStatus.DONE,
      });
    }
    if (f.unassigned === true) {
      qb.andWhere(`NOT EXISTS (SELECT 1 FROM task_assignees f_un WHERE f_un.task_id = "task"."id")`);
    }
    if (f.unassigned === false) {
      qb.andWhere(`EXISTS (SELECT 1 FROM task_assignees f_as WHERE f_as.task_id = "task"."id")`);
    }
    if (f.dueFrom) {
      qb.andWhere(`CAST("task"."end_date" AT TIME ZONE :fTz AS date) >= CAST(:fDueFrom AS date)`, {
        fTz: f.timeZone,
        fDueFrom: f.dueFrom,
      });
    }
    if (f.dueTo) {
      qb.andWhere(`CAST("task"."end_date" AT TIME ZONE :fTz AS date) <= CAST(:fDueTo AS date)`, {
        fTz: f.timeZone,
        fDueTo: f.dueTo,
      });
    }
    this.applyAssigneeLabelPriority(qb, f);
  }

  private applyAssigneeLabelPriority(
    qb: SelectQueryBuilder<Task>,
    f: { assigneeId?: string; labelId?: string; priority?: TaskPriority },
  ): void {
    if (f.priority) qb.andWhere('task.priority = :fPriority', { fPriority: f.priority });
    if (f.labelId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM task_labels f_tl WHERE f_tl.task_id = "task"."id" AND f_tl.label_id = :fLabel)`,
        { fLabel: f.labelId },
      );
    }
    if (f.assigneeId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM task_assignees f_ta WHERE f_ta.task_id = "task"."id" AND f_ta.user_id = :fAssignee)`,
        { fAssignee: f.assigneeId },
      );
    }
  }

  /** include=project : id et titre du projet seulement (jamais le budget). */
  private applyTaskIncludes(qb: SelectQueryBuilder<Task>, include: string[] | undefined): void {
    if (!include?.length) return;

    const unknown = include.filter((name) => name !== 'project');
    if (unknown.length > 0) {
      throw new ValidationFailedException([
        {
          field: 'include',
          reason: 'includeNotAllowed',
          message: `Relations non disponibles : ${unknown.join(', ')}. Disponibles : project.`,
        },
      ]);
    }
    qb.leftJoin('task.project', 'inc_project').addSelect(['inc_project.id', 'inc_project.title']);
  }

  /** Identifiants des responsables d'une tâche de l'entreprise. */
  async assigneeIds(companyId: string, taskId: string): Promise<string[]> {
    const rows: Array<{ user_id: string }> = await this.repo.manager.query(
      `SELECT ta.user_id
         FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
        WHERE t.company_id = $1 AND ta.task_id = $2`,
      [companyId, taskId],
    );
    return rows.map((row) => row.user_id);
  }
}