import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  CreateTaskDto,
  DuplicateTaskDto,
  MoveTaskDto,
  TaskCalendarQueryDto,
  TaskKanbanQueryDto,
  TaskListQueryDto,
  TaskMineQueryDto,
  UpdateTaskDto,
} from '../../dto/tasks/index.js';
import type { Task } from '../../entities/task.entity.js';
import { TaskStatus } from '../../enums/app.enums.js';
import {
  AccessDeniedException,
  BusinessRuleException,
  InvalidReferenceException,
} from '../../exceptions/index.js';
import { toTask } from '../../mapper/task.mapper.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { ProjectRepository } from '../../repository/project.repository.js';
import type { UpdateChanges } from '../../repository/index.js';
import { TaskRepository } from '../../repository/task.repository.js';
import type { TaskViewer } from '../../repository/task.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { todayIn, weekRange } from '../projects/project-dates.js';
import {
  assertDateOrder,
  completionChange,
  toDate,
  unique,
  viewerOf,
} from './task-rules.js';
import { NotificationService } from '../notifications/notification.service.js';
import { notificationTemplates } from '../notifications/notification-templates.js';

const MAX_CALENDAR_DAYS = 366;
const COLLABORATOR_FIELDS = ['version', 'status', 'description'];

/** Informations d'un changement de statut, recueillies dans la transaction. */
interface StatusChange {
  title: string;
  to: TaskStatus;
  assigneeIds: string[];
}

@Injectable()
export class TaskService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
    private readonly companies: CompanyRepository,
    private readonly notifications: NotificationService,
  ) { }

  // ---------- Lectures ----------

  async list(viewer: AuthenticatedUser, query: TaskListQueryDto) {
    const ctx = viewerOf(viewer);
    const archived = query.archived ?? 'exclude';
    if (!ctx.privileged && archived !== 'exclude') {
      throw new AccessDeniedException('Le filtre archived est réservé aux administrateurs et managers.');
    }

    const timeZone = await this.timeZoneFor(viewer.companyId);
    const result = await this.tasks.list(viewer.companyId, query, ctx, archived, {
      projectId: query.project_id,
      parentTaskId: query.parent_task_id,
      topLevel: query.top_level,
      status: query.status,
      priority: query.priority,
      labelId: query.label_id,
      assigneeId: query.assignee_id,
      unassigned: query.unassigned,
      overdue: query.overdue,
      dueFrom: query.due_from,
      dueTo: query.due_to,
      timeZone,
    });

    const extras = await this.tasks.extrasFor(viewer.companyId, result.items.map((t) => t.id));
    const now = new Date();
    return result.map((task) => toTask(task, extras, now));
  }

  /** Fiche tâche avec ses sous-tâches. */
  async get(viewer: AuthenticatedUser, id: string) {
    const ctx = viewerOf(viewer);
    const task = await this.tasks.getVisible(viewer.companyId, id, ctx, {
      includeArchived: ctx.privileged,
    });
    const subtasks = await this.tasks.listSubtasks(viewer.companyId, id, ctx);
    const extras = await this.tasks.extrasFor(viewer.companyId, [id, ...subtasks.map((s) => s.id)]);

    const now = new Date();
    return {
      ...toTask(task, extras, now),
      subtasks: subtasks.map((subtask) => toTask(subtask, extras, now)),
    };
  }

  /** Une tâche telle que renvoyée après une écriture (sans ses sous-tâches). */
  async view(viewer: AuthenticatedUser, id: string) {
    const ctx = viewerOf(viewer);
    const task = await this.tasks.getVisible(viewer.companyId, id, ctx, {
      includeArchived: ctx.privileged,
    });
    const extras = await this.tasks.extrasFor(viewer.companyId, [id]);
    return toTask(task, extras, new Date());
  }

  async kanban(viewer: AuthenticatedUser, query: TaskKanbanQueryDto) {
    const ctx = viewerOf(viewer);
    // Admin et manager : 404 si le projet n'existe pas dans l'entreprise
    if (ctx.privileged) {
      await this.projects.getByIdIncludingArchived(viewer.companyId, query.project_id);
    }

    const cards = await this.tasks.kanban(viewer.companyId, ctx, {
      projectId: query.project_id,
      assigneeId: query.assignee_id,
      labelId: query.label_id,
      priority: query.priority,
    });
    const extras = await this.tasks.extrasFor(viewer.companyId, cards.map((c) => c.id));
    const now = new Date();

    return {
      project_id: query.project_id,
      columns: Object.values(TaskStatus).map((status) => {
        const tasks = cards.filter((card) => card.status === status).map((c) => toTask(c, extras, now));
        return { status, count: tasks.length, tasks };
      }),
    };
  }

  async calendar(viewer: AuthenticatedUser, query: TaskCalendarQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() < from.getTime()) {
      throw new BusinessRuleException('« to » ne peut pas précéder « from ».');
    }
    if (to.getTime() - from.getTime() > MAX_CALENDAR_DAYS * 86_400_000) {
      throw new BusinessRuleException(`La plage demandée ne peut pas dépasser ${MAX_CALENDAR_DAYS} jours.`);
    }

    const tasks = await this.tasks.calendar(viewer.companyId, viewerOf(viewer), {
      from,
      to,
      projectId: query.project_id,
      assigneeId: query.assignee_id,
    });
    const extras = await this.tasks.extrasFor(viewer.companyId, tasks.map((t) => t.id));
    const now = new Date();

    const byProject = new Map<
      string,
      { project: { id: string; title: string }; tasks: ReturnType<typeof toTask>[] }
    >();
    for (const task of tasks) {
      const entry = byProject.get(task.projectId) ?? {
        project: { id: task.projectId, title: task.project?.title ?? '' },
        tasks: [],
      };
      entry.tasks.push(toTask(task, extras, now));
      byProject.set(task.projectId, entry);
    }

    return { from: from.toISOString(), to: to.toISOString(), projects: [...byProject.values()] };
  }

  /** « Mes tâches », groupées par échéance (dates locales de l'entreprise). */
  async mine(viewer: AuthenticatedUser, query: TaskMineQueryDto) {
    const timeZone = await this.timeZoneFor(viewer.companyId);
    const now = new Date();
    const today = todayIn(timeZone, now);
    const weekEnd = weekRange(today).to;

    const tasks = await this.tasks.mine(viewer.companyId, viewer.id, query.include_done === true);
    const extras = await this.tasks.extrasFor(viewer.companyId, tasks.map((t) => t.id));

    const groups = {
      overdue: [] as ReturnType<typeof toTask>[],
      today: [] as ReturnType<typeof toTask>[],
      this_week: [] as ReturnType<typeof toTask>[],
      later: [] as ReturnType<typeof toTask>[],
      no_date: [] as ReturnType<typeof toTask>[],
      completed: [] as ReturnType<typeof toTask>[],
    };

    for (const task of tasks) {
      const view = toTask(task, extras, now);
      if (task.status === TaskStatus.DONE) {
        groups.completed.push(view);
      } else if (task.endDate === null) {
        groups.no_date.push(view);
      } else {
        const due = todayIn(timeZone, task.endDate);
        if (due < today) groups.overdue.push(view);
        else if (due === today) groups.today.push(view);
        else if (due <= weekEnd) groups.this_week.push(view);
        else groups.later.push(view);
      }
    }
    return { today, groups };
  }

  // ---------- Écritures ----------

  async create(user: AuthenticatedUser, dto: CreateTaskDto) {
    const { companyId } = user;

    // Projet actif de l'entreprise (sinon 422 sur project_id)
    await this.projects.assertReference(companyId, dto.project_id, 'project_id');

    const startDate = toDate(dto.start_date) ?? null;
    const endDate = toDate(dto.end_date) ?? null;
    assertDateOrder(startDate, endDate);

    const assigneeIds = unique(dto.assignee_ids);
    const labelIds = unique(dto.label_ids);
    const status = dto.status ?? TaskStatus.TODO;

    const newId = await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);

      if (dto.parent_task_id) {
        await this.assertValidParent(repo, companyId, dto.parent_task_id, dto.project_id);
      }
      await repo.assertActiveUsers(companyId, assigneeIds, 'assignee_ids');
      await repo.assertLabelsExist(companyId, labelIds, 'label_ids');

      const position = await repo.nextPosition(
        companyId,
        dto.project_id,
        dto.parent_task_id ?? null,
        status,
      );
      const created = await repo.createOne(companyId, {
        projectId: dto.project_id,
        parentTaskId: dto.parent_task_id ?? null,
        title: dto.title,
        description: dto.description ?? null,
        status,
        priority: dto.priority,
        position,
        startDate,
        endDate,
        completedAt: status === TaskStatus.DONE ? new Date() : null,
        createdById: user.id,
      });

      await repo.addAssignees(created.id, assigneeIds);
      await repo.addLabels([created.id], labelIds);
      return created.id;
    });

    await this.notifications.notify({
      companyId,
      recipientIds: assigneeIds,
      actorId: user.id,
      ...notificationTemplates.taskAssigned({ id: newId, title: dto.title }),
    });

    return this.view(user, newId);
  }

  /**
   * Admin et manager : tous les champs. Collaborateur : statut et description de ses tâches
   * assignées uniquement. Le statut d'une tâche passe aussi par ici (completed_at géré).
   */
  async update(viewer: AuthenticatedUser, id: string, dto: UpdateTaskDto) {
    const ctx = viewerOf(viewer);
    const { companyId } = viewer;

    if (!ctx.privileged) {
      const forbidden = Object.entries(dto)
        .filter(([key, value]) => value !== undefined && !COLLABORATOR_FIELDS.includes(key))
        .map(([key]) => key);
      if (forbidden.length > 0) {
        throw new AccessDeniedException(
          `Un collaborateur ne peut modifier que le statut et la description de ses tâches (champs refusés : ${forbidden.join(', ')}).`,
        );
      }
    }

    const statusChange = await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);
      const before = await repo.getVisible(companyId, id, ctx);
      await this.assertCanEditAssigned(repo, viewer, ctx, id);

      const changes: Record<string, unknown> = {};
      if (dto.title !== undefined) changes.title = dto.title;
      if (dto.description !== undefined) changes.description = dto.description;
      if (dto.priority !== undefined) changes.priority = dto.priority;

      if (dto.start_date !== undefined || dto.end_date !== undefined) {
        const start = dto.start_date === undefined ? before.startDate : (toDate(dto.start_date) ?? null);
        const end = dto.end_date === undefined ? before.endDate : (toDate(dto.end_date) ?? null);
        assertDateOrder(start, end);
        if (dto.start_date !== undefined) changes.startDate = start;
        if (dto.end_date !== undefined) changes.endDate = end;
      }

      let change: StatusChange | null = null;
      if (dto.status !== undefined && dto.status !== before.status) {
        changes.status = dto.status;
        Object.assign(changes, completionChange(before.status, dto.status));
        // Nouvelle colonne : la carte arrive en bas
        changes.position = await repo.nextPosition(
          companyId,
          before.projectId,
          before.parentTaskId,
          dto.status,
        );
        change = {
          title: dto.title ?? before.title,
          to: dto.status,
          assigneeIds: await repo.assigneeIds(companyId, id),
        };
      }

      if (Object.keys(changes).length === 0) return null;

      // 409 VERSION_CONFLICT si la version envoyée n'est plus la bonne
      await repo.updateWithVersion(companyId, id, dto.version, changes as UpdateChanges<Task>);
      return change;
    });

    if (statusChange) await this.notifyStatusChange(viewer, id, statusChange);
    return this.view(viewer, id);
  }

  /** Déplacement d'une carte Kanban : statut + position, en une seule opération légère. */
  async move(viewer: AuthenticatedUser, id: string, dto: MoveTaskDto) {
    const ctx = viewerOf(viewer);
    const { companyId } = viewer;

    const statusChange = await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);
      const task = await repo.getVisible(companyId, id, ctx);
      await this.assertCanEditAssigned(repo, viewer, ctx, id);

      const position = await repo.placeInColumn(companyId, task, dto.status, dto.after_task_id ?? null);
      await repo.updateWithVersion(companyId, id, dto.version, {
        status: dto.status,
        position,
        ...completionChange(task.status, dto.status),
      } as UpdateChanges<Task>);

      if (task.status === dto.status) return null; // simple réordonnancement dans la colonne
      const change: StatusChange = {
        title: task.title,
        to: dto.status,
        assigneeIds: await repo.assigneeIds(companyId, id),
      };
      return change;
    });

    if (statusChange) await this.notifyStatusChange(viewer, id, statusChange);
    return this.view(viewer, id);
  }

  /** Idempotent. Archive aussi les sous-tâches actives. */
  async archive(user: AuthenticatedUser, id: string) {
    await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);
      const task = await repo.getByIdIncludingArchived(user.companyId, id);
      if (!task.archivedAt) await repo.archiveTrees(user.companyId, [id]);
    });
    return this.view(user, id);
  }

  /** Idempotent. Restaure aussi les sous-tâches archivées en même temps. */
  async restore(user: AuthenticatedUser, id: string) {
    await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);
      const task = await repo.getByIdIncludingArchived(user.companyId, id);
      if (!task.archivedAt) return;

      if (task.parentTaskId) {
        const parent = await repo.getByIdIncludingArchived(user.companyId, task.parentTaskId);
        if (parent.archivedAt) {
          throw new BusinessRuleException(
            "La tâche parente est archivée : restaurez-la d'abord.",
          );
        }
      }
      await repo.restoreTree(user.companyId, id);
    });
    return this.view(user, id);
  }

  /**
   * Copie dans le même projet : à faire, sans responsable, avec priorité, dates, étiquettes
   * et (pour une tâche de premier niveau) ses sous-tâches actives.
   */
  async duplicate(user: AuthenticatedUser, id: string, dto: DuplicateTaskDto) {
    const { companyId } = user;

    const newId = await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);
      const source = await repo.getById(companyId, id);

      const title = (dto.title ?? `Copie de ${source.title}`).slice(0, 150);
      const position = await repo.nextPosition(
        companyId,
        source.projectId,
        source.parentTaskId,
        TaskStatus.TODO,
      );
      const created = await repo.createOne(companyId, {
        projectId: source.projectId,
        parentTaskId: source.parentTaskId,
        title,
        description: source.description,
        status: TaskStatus.TODO,
        priority: source.priority,
        position,
        startDate: source.startDate,
        endDate: source.endDate,
        createdById: user.id,
      });

      await repo.copyLabels(companyId, source.id, created.id);
      if (source.parentTaskId === null) {
        await repo.copySubtasks(companyId, source.id, created.id, user.id);
      }
      return created.id;
    });

    return this.view(user, newId);
  }

  // ---------- Outils internes ----------

  /** Parent : tâche active de premier niveau du même projet. */
  private async assertValidParent(
    repo: TaskRepository,
    companyId: string,
    parentId: string,
    projectId: string,
  ): Promise<void> {
    const parent = await repo.findById(companyId, parentId);
    if (!parent || parent.projectId !== projectId) {
      throw new InvalidReferenceException('parent_task_id', 'Tâche parente');
    }
    if (parent.parentTaskId !== null) {
      throw new BusinessRuleException('Une sous-tâche ne peut pas avoir elle-même de sous-tâches.');
    }
  }

  /** Les responsables de la tâche sont prévenus (sauf l'auteur du changement). */
  private notifyStatusChange(
    actor: AuthenticatedUser,
    taskId: string,
    change: StatusChange,
  ): Promise<void> {
    return this.notifications.notify({
      companyId: actor.companyId,
      recipientIds: change.assigneeIds,
      actorId: actor.id,
      ...notificationTemplates.taskStatusChanged({ id: taskId, title: change.title }, change.to),
    });
  }

  /** Un collaborateur ne modifie que les tâches qui lui sont assignées. */
  private async assertCanEditAssigned(
    repo: TaskRepository,
    viewer: AuthenticatedUser,
    ctx: TaskViewer,
    taskId: string,
  ): Promise<void> {
    if (ctx.privileged) return;
    if (!(await repo.isAssigned(viewer.companyId, taskId, viewer.id))) {
      throw new AccessDeniedException('Vous ne pouvez modifier que les tâches qui vous sont assignées.');
    }
  }

  private async timeZoneFor(companyId: string): Promise<string> {
    return (await this.companies.getById(companyId)).timezone;
  }
}