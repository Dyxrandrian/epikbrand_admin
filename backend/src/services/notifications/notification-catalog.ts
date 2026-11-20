import { NotificationType } from '../../enums/notification.enums.js';

export const NOTIFICATION_CATALOG: ReadonlyArray<{
  type: NotificationType;
  label: string;
  description: string;
}> = [
    {
      type: NotificationType.TASK_ASSIGNED,
      label: 'Tâche assignée',
      description: 'Quand une tâche vous est assignée.',
    },
    {
      type: NotificationType.TASK_STATUS_CHANGED,
      label: "Changement de statut d'une tâche",
      description: 'Quand le statut d\'une de vos tâches change.',
    },
    {
      type: NotificationType.PROJECT_STATUS_CHANGED,
      label: "Changement de statut d'un projet",
      description: "Quand le statut d'un projet auquel vous participez change.",
    },
    {
      type: NotificationType.TASK_MENTION,
      label: 'Mention dans un commentaire',
      description: 'Quand quelqu\'un vous mentionne dans un commentaire de tâche.',
    },
    {
      type: NotificationType.LEAVE_REQUEST_CREATED,
      label: 'Nouvelle demande de congé',
      description: 'Pour les managers et administrateurs : une demande est à valider.',
    },
    {
      type: NotificationType.LEAVE_REQUEST_DECIDED,
      label: 'Décision sur une demande de congé',
      description: 'Quand votre demande de congé est approuvée ou rejetée.',
    },
    {
      type: NotificationType.TRAINING_REQUEST_CREATED,
      label: 'Nouvelle demande de formation',
      description: 'Pour les managers et administrateurs : une demande est à valider.',
    },
    {
      type: NotificationType.TRAINING_REQUEST_DECIDED,
      label: 'Décision sur une demande de formation',
      description: 'Quand votre demande de formation est approuvée ou rejetée.',
    },
    {
      type: NotificationType.INVOICE_OVERDUE,
      label: 'Facture en retard',
      description: "Quand l'échéance d'une facture est dépassée sans paiement.",
    },
    {
      type: NotificationType.EXPENSE_DUE,
      label: 'Dépense échue',
      description: "Quand l'échéance d'une dépense est atteinte sans paiement.",
    },
    {
      type: NotificationType.ARTICLE_PUBLISHED,
      label: 'Nouvel article publié',
      description: 'Quand un article est publié dans la base de connaissance.',
    },
    {
      type: NotificationType.EXPENSE_SUBMITTED,
      label: 'Note de frais à valider',
      description: 'Pour les managers et administrateurs : une note de frais attend votre validation.',
    },
    {
      type: NotificationType.EXPENSE_DECIDED,
      label: 'Décision sur une dépense',
      description: 'Quand votre dépense est validée, payée ou annulée.',
    },
  ];

export type NotificationChannel = 'in_app' | 'email';

/** Application activée, e-mail désactivé tant que l'utilisateur ne le demande pas. */
export const DEFAULT_CHANNELS: Record<NotificationChannel, boolean> = {
  in_app: true,
  email: false,
};

export const channelKey = (type: NotificationType, channel: NotificationChannel): string =>
  `${type}.${channel}`;

/** Valeur choisie par l'utilisateur, sinon la valeur par défaut du canal. */
export function resolvePreference(
  stored: Record<string, unknown> | null | undefined,
  type: NotificationType,
  channel: NotificationChannel,
): boolean {
  const value = stored?.[channelKey(type, channel)];
  return typeof value === 'boolean' ? value : DEFAULT_CHANNELS[channel];
}