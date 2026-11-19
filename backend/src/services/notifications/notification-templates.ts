import { ProjectStatus, TaskStatus } from '../../enums/app.enums.js';
import { NotificationType } from '../../enums/notification.enums.js';

// Chemins du frontend : à adapter à vos routes
export const taskLink = (id: string): string => `/tasks/${id}`;
export const projectLink = (id: string): string => `/projects/${id}`;
export const MY_TASKS_LINK = '/tasks/mine';

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: 'À faire',
  [TaskStatus.IN_PROGRESS]: 'En cours',
  [TaskStatus.REVIEW]: 'En revue',
  [TaskStatus.DONE]: 'Terminée',
};

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  [ProjectStatus.PENDING]: 'En attente',
  [ProjectStatus.ONGOING]: 'En cours',
  [ProjectStatus.DELIVERED]: 'Livré',
};

const quote = (title: string): string => `« ${title} »`;

export const notificationTemplates = {
  taskAssigned: (task: { id: string; title: string }) => ({
    type: NotificationType.TASK_ASSIGNED,
    title: 'Nouvelle tâche assignée',
    content: `Vous avez été assigné à la tâche ${quote(task.title)}.`,
    redirectUrl: taskLink(task.id),
  }),

  tasksAssigned: (count: number) => ({
    type: NotificationType.TASK_ASSIGNED,
    title: 'Nouvelles tâches assignées',
    content: `Vous avez été assigné à ${count} tâches.`,
    redirectUrl: MY_TASKS_LINK,
  }),

  taskStatusChanged: (task: { id: string; title: string }, status: TaskStatus) => ({
    type: NotificationType.TASK_STATUS_CHANGED,
    title: "Statut d'une tâche modifié",
    content: `La tâche ${quote(task.title)} est passée à « ${TASK_STATUS_LABELS[status]} ».`,
    redirectUrl: taskLink(task.id),
  }),

  projectStatusChanged: (project: { id: string; title: string }, status: ProjectStatus) => ({
    type: NotificationType.PROJECT_STATUS_CHANGED,
    title: "Statut d'un projet modifié",
    content: `Le projet ${quote(project.title)} est passé à « ${PROJECT_STATUS_LABELS[status]} ».`,
    redirectUrl: projectLink(project.id),
  }),

  taskMention: (task: { id: string; title: string }, authorName: string) => ({
    type: NotificationType.TASK_MENTION,
    title: 'Vous avez été mentionné',
    content: `${authorName} vous a mentionné dans un commentaire sur la tâche ${quote(task.title)}.`,
    redirectUrl: taskLink(task.id),
  }),
};