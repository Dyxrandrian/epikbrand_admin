import { Injectable } from '@nestjs/common';
import type { PageQueryDto } from '../../dto/index.js';
import type {
  CreateTaskCommentDto,
  UpdateTaskCommentDto,
} from '../../dto/tasks/task-comment.dto.js';
import { AccessDeniedException, InvalidReferenceException } from '../../exceptions/index.js';
import { toTaskComment } from '../../mapper/task.mapper.js';
import { TaskCommentRepository } from '../../repository/task-comment.repository.js';
import type { UpdateChanges } from '../../repository/index.js';
import { TaskRepository } from '../../repository/task.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import type { TaskComment } from '../../entities/task-comment.entity.js';
import { unique, viewerOf } from './task-rules.js';
import { NotificationService } from '../notifications/notification.service.js';
import { notificationTemplates } from '../notifications/notification-templates.js';
import type { Task } from '../../entities/task.entity.js';

@Injectable()
export class TaskCommentService {
  constructor(
    private readonly comments: TaskCommentRepository,
    private readonly tasks: TaskRepository,
    private readonly notifications: NotificationService,
  ) { }

  async list(viewer: AuthenticatedUser, taskId: string, query: PageQueryDto) {
    const ctx = viewerOf(viewer);
    await this.tasks.getVisible(viewer.companyId, taskId, ctx, { includeArchived: ctx.privileged });

    const result = await this.comments.listForTask(viewer.companyId, taskId, query);
    return result.map(toTaskComment);
  }

  /** L'auteur est toujours l'utilisateur connecté. Tâche active et visible requise. */
  /** L'auteur est toujours l'utilisateur connecté. Tâche active et visible requise. */
  async create(viewer: AuthenticatedUser, taskId: string, dto: CreateTaskCommentDto) {
    const { companyId } = viewer;
    const task = await this.tasks.getVisible(companyId, taskId, viewerOf(viewer));
    const mentions = await this.resolveMentions(companyId, task.projectId, dto.mentioned_user_ids);

    const created = await this.comments.createOne(companyId, {
      taskId: task.id,
      userId: viewer.id,
      content: dto.content,
      mentionedUserIds: mentions,
    });

    await this.notifications.notify({
      companyId,
      recipientIds: mentions,
      actorId: viewer.id,
      ...notificationTemplates.taskMention({ id: task.id, title: task.title }, viewer.name),
    });
    return toTaskComment(await this.comments.getDetailed(companyId, created.id));
  }

  /** Seul l'auteur modifie son commentaire. Seules les NOUVELLES mentions sont notifiées. */
  async update(viewer: AuthenticatedUser, id: string, dto: UpdateTaskCommentDto) {
    const { companyId } = viewer;
    const comment = await this.comments.getById(companyId, id);
    if (comment.userId !== viewer.id) {
      throw new AccessDeniedException("Seul l'auteur peut modifier ce commentaire.");
    }

    const changes: Record<string, unknown> = {};
    if (dto.content !== undefined) changes.content = dto.content;

    let mentionTask: Task | null = null;
    let addedMentions: string[] = [];
    if (dto.mentioned_user_ids !== undefined) {
      const task = await this.tasks.getByIdIncludingArchived(companyId, comment.taskId);
      const mentions = await this.resolveMentions(companyId, task.projectId, dto.mentioned_user_ids);
      changes.mentionedUserIds = mentions;

      const previous = new Set(comment.mentionedUserIds);
      mentionTask = task;
      addedMentions = task.archivedAt ? [] : mentions.filter((userId) => !previous.has(userId));
    }

    if (Object.keys(changes).length > 0) {
      await this.comments.updateById(companyId, id, changes as UpdateChanges<TaskComment>);
    }

    if (mentionTask && addedMentions.length > 0) {
      await this.notifications.notify({
        companyId,
        recipientIds: addedMentions,
        actorId: viewer.id,
        ...notificationTemplates.taskMention(
          { id: mentionTask.id, title: mentionTask.title },
          viewer.name,
        ),
      });
    }
    return toTaskComment(await this.comments.getDetailed(companyId, id));
  }

  /** L'auteur, un manager ou un admin. */
  async remove(viewer: AuthenticatedUser, id: string): Promise<void> {
    const comment = await this.comments.getById(viewer.companyId, id);
    const privileged = viewerOf(viewer).privileged;
    if (!privileged && comment.userId !== viewer.id) {
      throw new AccessDeniedException(
        "Seuls l'auteur, un manager ou un administrateur peuvent supprimer ce commentaire.",
      );
    }
    await this.comments.deleteById(viewer.companyId, id);
  }

  /** Chaque personne citée doit être active et pouvoir voir la tâche. */
  private async resolveMentions(
    companyId: string,
    projectId: string,
    ids: string[] | undefined,
  ): Promise<string[]> {
    const mentions = unique(ids);
    if (mentions.length === 0) return [];

    const allowed = await this.tasks.mentionableUserIds(companyId, projectId, mentions);
    if (allowed.length !== mentions.length) {
      throw new InvalidReferenceException('mentioned_user_ids', 'Utilisateur mentionné');
    }
    return mentions;
  }
}