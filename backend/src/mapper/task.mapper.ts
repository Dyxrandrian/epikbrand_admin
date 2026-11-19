import type { TaskComment } from '../entities/task-comment.entity.js';
import type { Task } from '../entities/task.entity.js';
import { TaskStatus } from '../enums/app.enums.js';
import type { TaskExtras } from '../repository/task.repository.js';

/**
 * Progression : celle des sous-tâches si la tâche en a, sinon 100 si elle est terminée, 0 sinon.
 * `project` n'apparaît que si la relation a été chargée.
 */
export function toTask(task: Task, extras: TaskExtras, now: Date) {
  const subtasks = extras.subtasks.get(task.id) ?? { total: 0, done: 0 };
  const progress =
    subtasks.total > 0
      ? Math.round((subtasks.done * 100) / subtasks.total)
      : task.status === TaskStatus.DONE
        ? 100
        : 0;

  return {
    id: task.id,
    project_id: task.projectId,
    parent_task_id: task.parentTaskId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    position: task.position,
    start_date: task.startDate,
    end_date: task.endDate,
    completed_at: task.completedAt,
    is_overdue:
      task.endDate !== null &&
      task.endDate.getTime() < now.getTime() &&
      task.status !== TaskStatus.DONE,
    progress,
    subtasks_summary: subtasks,
    comments_count: extras.comments.get(task.id) ?? 0,
    assignees: (extras.assignees.get(task.id) ?? []).map((user) => ({
      id: user.id,
      name: user.name,
      avatar_url: user.avatarUrl,
    })),
    labels: extras.labels.get(task.id) ?? [],
    ...(task.project ? { project: { id: task.project.id, title: task.project.title } } : {}),
    archived_at: task.archivedAt,
    version: task.version, // à renvoyer lors d'une modification ou d'un déplacement
    created_by: task.createdById,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

/** `author` n'apparaît que si la relation a été chargée (null si l'auteur a été supprimé). */
export function toTaskComment(comment: TaskComment) {
  return {
    id: comment.id,
    task_id: comment.taskId,
    user_id: comment.userId,
    ...(comment.user !== undefined
      ? {
          author: comment.user
            ? { id: comment.user.id, name: comment.user.name, avatar_url: comment.user.avatarUrl }
            : null,
        }
      : {}),
    content: comment.content,
    mentioned_user_ids: comment.mentionedUserIds,
    is_edited: comment.updatedAt.getTime() - comment.createdAt.getTime() > 1000,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
  };
}