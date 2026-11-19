import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { BulkTasksDto } from '../../dto/tasks/bulk-tasks.dto.js';
import type { AddAssigneesDto, SetLabelsDto } from '../../dto/tasks/task-assignment.dto.js';
import {
  ConflictAppException,
  ErrorCode,
  InvalidReferenceException,
  ResourceNotFoundException,
} from '../../exceptions/index.js';
import { TaskRepository } from '../../repository/task.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { unique } from './task-rules.js';
import { TaskService } from './task.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { notificationTemplates } from '../notifications/notification-templates.js';

@Injectable()
export class TaskAssignmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tasks: TaskRepository,
    private readonly taskService: TaskService,
    private readonly notifications: NotificationService,
  ) { }

  /** Ajoute des responsables. 409 (sans rien enregistrer) si l'un d'eux l'est déjà. */
  async addAssignees(user: AuthenticatedUser, taskId: string, dto: AddAssigneesDto) {
    const { companyId } = user;
    const userIds = unique(dto.user_ids);

    const task = await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);
      const found = await repo.getById(companyId, taskId); // 404 si archivée, introuvable ou étrangère
      await repo.assertActiveUsers(companyId, userIds, 'user_ids');

      const inserted = await repo.addAssignees(taskId, userIds);
      if (inserted.length !== userIds.length) {
        const already = userIds.filter((id) => !inserted.includes(id));
        throw new ConflictAppException(
          'Un ou plusieurs utilisateurs sont déjà assignés à cette tâche.',
          ErrorCode.DUPLICATE_RESOURCE,
          { already_assigned: already },
        );
      }
      return found;
    });

    await this.notifications.notify({
      companyId,
      recipientIds: userIds,
      actorId: user.id,
      ...notificationTemplates.taskAssigned({ id: task.id, title: task.title }),
    });
    return this.taskService.view(user, taskId);
  }

  async removeAssignee(user: AuthenticatedUser, taskId: string, userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);
      await repo.getById(user.companyId, taskId);
      if (!(await repo.removeAssignee(user.companyId, taskId, userId))) {
        throw new ResourceNotFoundException('Assignation');
      }
    });
  }

  /** Remplace l'ensemble des étiquettes de la tâche. */
  async setLabels(user: AuthenticatedUser, taskId: string, dto: SetLabelsDto) {
    const labelIds = unique(dto.label_ids);

    await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);
      await repo.getById(user.companyId, taskId);
      await repo.assertLabelsExist(user.companyId, labelIds, 'label_ids');
      await repo.replaceLabels(user.companyId, [taskId], labelIds);
    });
    return this.taskService.view(user, taskId);
  }

  /** Une action sur plusieurs tâches, tout ou rien. Toutes doivent être actives et de l'entreprise. */
  async bulk(user: AuthenticatedUser, dto: BulkTasksDto) {
    const { companyId } = user;
    const taskIds = unique(dto.task_ids);

    const { affected, assigned, titles } = await this.dataSource.transaction(async (manager) => {
      const repo = this.tasks.withManager(manager);

      const found = await repo.findActiveByIds(companyId, taskIds);
      if (found.length !== taskIds.length) throw new InvalidReferenceException('task_ids', 'Tâche');

      let added: Array<{ taskId: string; userId: string }> = [];
      switch (dto.action) {
        case 'status':
          await repo.bulkSetStatus(companyId, taskIds, dto.status as NonNullable<typeof dto.status>);
          break;
        case 'assign': {
          const userIds = unique(dto.assignee_ids);
          await repo.assertActiveUsers(companyId, userIds, 'assignee_ids');
          added = await repo.replaceAssignees(companyId, taskIds, userIds);
          break;
        }
        case 'add_labels': {
          const labelIds = unique(dto.label_ids);
          await repo.assertLabelsExist(companyId, labelIds, 'label_ids');
          await repo.addLabels(taskIds, labelIds);
          break;
        }
        case 'remove_labels':
          await repo.removeLabels(companyId, taskIds, unique(dto.label_ids));
          break;
        case 'archive':
          await repo.archiveTrees(companyId, taskIds);
          break;
      }
      return {
        affected: found.length,
        assigned: added,
        titles: new Map(found.map((task) => [task.id, task.title])),
      };
    });

    await this.notifyBulkAssignments(user, assigned, titles);
    return { action: dto.action, affected };
  }

  /** Une notification par personne : détaillée pour une tâche, groupée au-delà. */
  private async notifyBulkAssignments(
    actor: AuthenticatedUser,
    assigned: ReadonlyArray<{ taskId: string; userId: string }>,
    titles: ReadonlyMap<string, string>,
  ): Promise<void> {
    const byUser = new Map<string, Array<{ id: string; title: string }>>();
    for (const { taskId, userId } of assigned) {
      const list = byUser.get(userId) ?? [];
      list.push({ id: taskId, title: titles.get(taskId) ?? '' });
      byUser.set(userId, list);
    }

    for (const [userId, tasks] of byUser) {
      const template =
        tasks.length === 1
          ? notificationTemplates.taskAssigned(tasks[0])
          : notificationTemplates.tasksAssigned(tasks.length);
      await this.notifications.notify({
        companyId: actor.companyId,
        recipientIds: [userId],
        actorId: actor.id,
        ...template,
      });
    }
  }
}