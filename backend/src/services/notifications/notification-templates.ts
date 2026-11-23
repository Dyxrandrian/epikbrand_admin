import { ProjectStatus, TaskStatus } from '../../enums/app.enums.js';
import { NotificationType } from '../../enums/notification.enums.js';
import { formatDate } from '../invoices/pdf/pdf-format.js';

// Chemins du frontend : à adapter à vos routes
export const taskLink = (id: string): string => `/tasks/${id}`;
export const expenseLink = (id: string): string => `/expenses/${id}`;
export const leaveLink = (id: string): string => `/leave-requests/${id}`;
export const trainingLink = (id: string): string => `/training-requests/${id}`;

type RequestDecision = 'approved' | 'rejected' | 'cancelled';

const LEAVE_DECISION_TITLES: Record<RequestDecision, string> = {
  approved: 'Demande de congé approuvée',
  rejected: 'Demande de congé rejetée',
  cancelled: 'Demande de congé annulée',
};
const TRAINING_DECISION_TITLES: Record<RequestDecision, string> = {
  approved: 'Demande de formation approuvée',
  rejected: 'Demande de formation rejetée',
  cancelled: 'Demande de formation annulée',
};
const REQUEST_DECISION_VERBS: Record<RequestDecision, string> = {
  approved: 'a été approuvée',
  rejected: 'a été rejetée',
  cancelled: 'a été annulée',
};

const withComment = (text: string, comment: string | null | undefined): string =>
  comment ? `${text} Commentaire : ${comment}` : text;

const EXPENSE_DECISION_TITLES = {
  validated: 'Dépense validée',
  paid: 'Dépense payée',
  cancelled: 'Dépense annulée',
} as const;

const EXPENSE_DECISION_VERBS = {
  validated: 'a été validée',
  paid: 'a été payée',
  cancelled: 'a été annulée',
} as const;
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

  leaveRequestCreated: (
    request: { id: string },
    authorName: string,
    startDate: string,
    endDate: string,
  ) => ({
    type: NotificationType.LEAVE_REQUEST_CREATED,
    title: 'Nouvelle demande de congé',
    content: `${authorName} demande un congé du ${formatDate(startDate)} au ${formatDate(endDate)}.`,
    redirectUrl: leaveLink(request.id),
  }),

  leaveRequestDecided: (
    request: { id: string; startDate: string; endDate: string },
    decision: RequestDecision,
    comment?: string | null,
  ) => ({
    type: NotificationType.LEAVE_REQUEST_DECIDED,
    title: LEAVE_DECISION_TITLES[decision],
    content: withComment(
      `Votre demande de congé du ${formatDate(request.startDate)} au ${formatDate(request.endDate)} ${REQUEST_DECISION_VERBS[decision]}.`,
      comment,
    ),
    redirectUrl: leaveLink(request.id),
  }),

  trainingRequestCreated: (
    request: { id: string; trainingName: string },
    authorName: string,
  ) => ({
    type: NotificationType.TRAINING_REQUEST_CREATED,
    title: 'Nouvelle demande de formation',
    content: `${authorName} demande la formation ${quote(request.trainingName)}.`,
    redirectUrl: trainingLink(request.id),
  }),

  trainingRequestDecided: (
    request: { id: string; trainingName: string },
    decision: RequestDecision,
    comment?: string | null,
  ) => ({
    type: NotificationType.TRAINING_REQUEST_DECIDED,
    title: TRAINING_DECISION_TITLES[decision],
    content: withComment(
      `Votre demande de formation ${quote(request.trainingName)} ${REQUEST_DECISION_VERBS[decision]}.`,
      comment,
    ),
    redirectUrl: trainingLink(request.id),
  }),

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

  expenseSubmitted: (expense: { id: string; title: string }, authorName: string) => ({
    type: NotificationType.EXPENSE_SUBMITTED,
    title: 'Note de frais à valider',
    content: `${authorName} a soumis la dépense ${quote(expense.title)}.`,
    redirectUrl: expenseLink(expense.id),
  }),

  expenseDecided: (
    expense: { id: string; title: string },
    decision: 'validated' | 'paid' | 'cancelled',
  ) => ({
    type: NotificationType.EXPENSE_DECIDED,
    title: EXPENSE_DECISION_TITLES[decision],
    content: `Votre dépense ${quote(expense.title)} ${EXPENSE_DECISION_VERBS[decision]}.`,
    redirectUrl: expenseLink(expense.id),
  }),
};