import { ProjectStatus, TaskStatus } from '../../enums/app.enums.js';
import { NotificationType } from '../../enums/notification.enums.js';
import { formatDate } from '../invoices/pdf/pdf-format.js';

// Chemins du frontend : à adapter à vos routes
export const taskLink = (id: string): string => `/tasks/${id}`;
export const expenseLink = (id: string): string => `/expenses/${id}`;
export const leaveLink = (id: string): string => `/leave-requests/${id}`;
export const trainingLink = (id: string): string => `/training-requests/${id}`;
export const invoiceLink = (id: string): string => `/invoices/${id}`;
export const INVOICES_LINK = '/invoices';
export const EXPENSES_LINK = '/expenses';
export const LEAVE_REQUESTS_LINK = '/leave-requests';
export const TRAINING_REQUESTS_LINK = '/training-requests';

type When = 'today' | 'tomorrow';
const WHEN_TEXT: Record<When, string> = { today: "aujourd'hui", tomorrow: 'demain' };

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

  invoiceOverdue: (invoice: {
    id: string;
    number: string;
    clientName: string;
    dueDate: string;
    balance: string;
  }) => ({
    type: NotificationType.INVOICE_OVERDUE,
    title: 'Facture en retard',
    content: `La facture ${invoice.number} de ${quote(invoice.clientName)} est en retard depuis le ${formatDate(invoice.dueDate)} (reste à payer : ${invoice.balance}).`,
    redirectUrl: invoiceLink(invoice.id),
  }),

  invoicesOverdue: (count: number) => ({
    type: NotificationType.INVOICE_OVERDUE,
    title: 'Factures en retard',
    content: `${count} autre(s) facture(s) sont passées en retard.`,
    redirectUrl: INVOICES_LINK,
  }),

  expenseRecurrenceGenerated: (expense: { id: string; title: string }, dates: string[]) => ({
    type: NotificationType.EXPENSE_RECURRING_GENERATED,
    title: 'Dépense récurrente générée',
    content:
      dates.length === 1
        ? `La dépense récurrente ${quote(expense.title)} a été générée pour le ${formatDate(dates[0])}.`
        : `${dates.length} occurrences de la dépense récurrente ${quote(expense.title)} ont été générées.`,
    redirectUrl: expenseLink(expense.id),
  }),

  tasksDue: (tasks: ReadonlyArray<{ id: string; title: string }>, when: When) =>
    tasks.length === 1
      ? {
        type: NotificationType.TASK_REMINDER,
        title: `Tâche à terminer ${WHEN_TEXT[when]}`,
        content: `La tâche ${quote(tasks[0].title)} arrive à échéance ${WHEN_TEXT[when]}.`,
        redirectUrl: taskLink(tasks[0].id),
      }
      : {
        type: NotificationType.TASK_REMINDER,
        title: `Tâches à terminer ${WHEN_TEXT[when]}`,
        content: `${tasks.length} de vos tâches arrivent à échéance ${WHEN_TEXT[when]}.`,
        redirectUrl: MY_TASKS_LINK,
      },

  projectDue: (project: { id: string; title: string }, when: When) => ({
    type: NotificationType.PROJECT_REMINDER,
    title: `Échéance de projet ${WHEN_TEXT[when]}`,
    content: `Le projet ${quote(project.title)} doit être livré ${WHEN_TEXT[when]}.`,
    redirectUrl: projectLink(project.id),
  }),

  invoiceDue: (
    invoice: { id: string; number: string; clientName: string; balance: string },
    when: When,
  ) => ({
    type: NotificationType.INVOICE_REMINDER,
    title: `Facture à échéance ${WHEN_TEXT[when]}`,
    content: `La facture ${invoice.number} de ${quote(invoice.clientName)} arrive à échéance ${WHEN_TEXT[when]} (reste à payer : ${invoice.balance}).`,
    redirectUrl: invoiceLink(invoice.id),
  }),

  invoicesDue: (count: number, when: When) => ({
    type: NotificationType.INVOICE_REMINDER,
    title: `Factures à échéance ${WHEN_TEXT[when]}`,
    content: `${count} autre(s) facture(s) arrivent à échéance ${WHEN_TEXT[when]}.`,
    redirectUrl: INVOICES_LINK,
  }),

  expenseDue: (expense: { id: string; title: string; amount: string }, when: When) => ({
    type: NotificationType.EXPENSE_REMINDER,
    title: `Dépense à payer ${WHEN_TEXT[when]}`,
    content: `La dépense ${quote(expense.title)} (${expense.amount}) est à payer ${WHEN_TEXT[when]}.`,
    redirectUrl: expenseLink(expense.id),
  }),

  expensesDue: (count: number, when: When) => ({
    type: NotificationType.EXPENSE_REMINDER,
    title: `Dépenses à payer ${WHEN_TEXT[when]}`,
    content: `${count} autre(s) dépense(s) sont à payer ${WHEN_TEXT[when]}.`,
    redirectUrl: EXPENSES_LINK,
  }),

  expenseOverdue: (expense: { id: string; title: string; amount: string; dueDate: string }) => ({
    type: NotificationType.EXPENSE_DUE,
    title: 'Dépense échue',
    content: `La dépense ${quote(expense.title)} (${expense.amount}) n'a pas été payée à son échéance du ${formatDate(expense.dueDate)}.`,
    redirectUrl: expenseLink(expense.id),
  }),

  expensesOverdue: (count: number) => ({
    type: NotificationType.EXPENSE_DUE,
    title: 'Dépenses échues',
    content: `${count} autre(s) dépense(s) sont échues sans paiement.`,
    redirectUrl: EXPENSES_LINK,
  }),

  approvalReminder: (kind: 'leave' | 'training', count: number) => ({
    type: NotificationType.APPROVAL_REMINDER,
    title: kind === 'leave' ? 'Demandes de congé en attente' : 'Demandes de formation en attente',
    content: `${count} ${kind === 'leave'
        ? count > 1 ? 'demandes de congé attendent' : 'demande de congé attend'
        : count > 1 ? 'demandes de formation attendent' : 'demande de formation attend'
      } votre validation depuis plusieurs jours.`,
    redirectUrl: kind === 'leave' ? LEAVE_REQUESTS_LINK : TRAINING_REQUESTS_LINK,
  }),
};