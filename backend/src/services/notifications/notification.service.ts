import { Injectable, Logger } from '@nestjs/common';
import type { NotificationListQueryDto } from '../../dto/notifications/notification-list-query.dto.js';
import type { UpdateNotificationPreferencesDto } from '../../dto/notifications/update-notification-preferences.dto.js';
import type { NotificationType } from '../../enums/notification.enums.js';
import { toNotification } from '../../mapper/notification.mapper.js';
import {
  NotificationPreferencesRepository,
  NotificationRepository,
} from '../../repository/notification.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationHub } from './notification-hub.js';
import {
  NOTIFICATION_CATALOG,
  channelKey,
  resolvePreference,
} from './notification-catalog.js';

const MAX_TITLE = 150;
const MAX_CONTENT = 2000;
const MAX_REDIRECT = 255;

export interface NotifyInput {
  companyId: string;
  type: NotificationType;
  recipientIds: readonly string[];
  title: string;
  content: string;
  /** Chemin relatif du frontend (ex. /tasks/<id>). */
  redirectUrl: string | null;
  /** Auteur de l'action : jamais notifié de sa propre action. */
  actorId?: string | null;
}

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: NotificationPreferencesRepository,
    private readonly hub: NotificationHub,
    private readonly mail: MailService,
  ) {}

  // ---------- Génération (appelée par les autres services, jamais par une route) ----------

  /**
   * À appeler APRÈS la validation de la transaction de l'action concernée.
   * Ne lève jamais d'erreur : un échec est journalisé et n'annule pas l'action.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      await this.deliver(input);
    } catch (error) {
      this.logger.error(`Échec d'envoi de notification (${input.type})`, error as Error);
    }
  }

  private async deliver(input: NotifyInput): Promise<void> {
    const redirectUrl = this.safeRedirect(input.redirectUrl);
    const title = truncate(input.title, MAX_TITLE);
    const content = truncate(input.content, MAX_CONTENT);

    const wanted = [...new Set(input.recipientIds)].filter((id) => id !== input.actorId);
    if (wanted.length === 0) return;

    // Seuls les utilisateurs actifs de l'entreprise de l'action peuvent être notifiés
    const recipients = await this.notifications.findRecipients(input.companyId, wanted);

    const inApp = recipients.filter((r) => resolvePreference(r.prefs, input.type, 'in_app'));
    const byEmail = recipients.filter((r) => resolvePreference(r.prefs, input.type, 'email'));

    if (inApp.length > 0) {
      const created = await this.notifications.insertMany(
        input.companyId,
        inApp.map((r) => ({ userId: r.id, type: input.type, title, content, redirectUrl })),
      );
      const unread = await this.notifications.unreadCounts(
        input.companyId,
        inApp.map((r) => r.id),
      );
      for (const notification of created) {
        this.hub.send(
          notification.userId,
          'notification',
          {
            notification: toNotification(notification),
            unread_count: unread.get(notification.userId) ?? 0,
          },
          notification.id,
        );
      }
    }

    for (const recipient of byEmail) {
      void this.mail
        .sendNotification(recipient.email, recipient.name, title, content, redirectUrl)
        .catch((error: unknown) =>
          this.logger.error("Échec d'envoi de l'e-mail de notification", error as Error),
        );
    }
  }

  // ---------- Lecture et gestion de ses notifications ----------

  async list(viewer: AuthenticatedUser, query: NotificationListQueryDto) {
    const result = await this.notifications.list(viewer.companyId, viewer.id, query);
    return result.map(toNotification);
  }

  unreadCount(viewer: AuthenticatedUser): Promise<number> {
    return this.notifications.unreadCount(viewer.companyId, viewer.id);
  }

  async markRead(viewer: AuthenticatedUser, id: string) {
    const notification = await this.notifications.markRead(viewer.companyId, viewer.id, id);
    await this.broadcastUnreadCount(viewer);
    return toNotification(notification);
  }

  async markAllRead(viewer: AuthenticatedUser) {
    const updated = await this.notifications.markAllRead(viewer.companyId, viewer.id);
    this.hub.send(viewer.id, 'unread_count', { unread_count: 0 });
    return { updated, unread_count: 0 };
  }

  async remove(viewer: AuthenticatedUser, id: string): Promise<void> {
    await this.notifications.deleteOwned(viewer.companyId, viewer.id, id);
    await this.broadcastUnreadCount(viewer);
  }

  // ---------- Préférences ----------

  async getPreferences(viewer: AuthenticatedUser) {
    const stored = await this.preferences.get(viewer.id);
    return NOTIFICATION_CATALOG.map((item) => ({
      type: item.type,
      label: item.label,
      description: item.description,
      in_app: resolvePreference(stored, item.type, 'in_app'),
      email: resolvePreference(stored, item.type, 'email'),
    }));
  }

  async updatePreferences(viewer: AuthenticatedUser, dto: UpdateNotificationPreferencesDto) {
    const patch: Record<string, boolean> = {};
    for (const item of dto.preferences) {
      if (typeof item.in_app === 'boolean') patch[channelKey(item.type, 'in_app')] = item.in_app;
      if (typeof item.email === 'boolean') patch[channelKey(item.type, 'email')] = item.email;
    }
    if (Object.keys(patch).length > 0) await this.preferences.merge(viewer.id, patch);
    return this.getPreferences(viewer);
  }

  // ---------- Outils internes ----------

  /** Tient à jour le compteur des autres onglets de l'utilisateur. */
  private async broadcastUnreadCount(viewer: AuthenticatedUser): Promise<void> {
    const count = await this.notifications.unreadCount(viewer.companyId, viewer.id);
    this.hub.send(viewer.id, 'unread_count', { unread_count: count });
  }

  /** Un lien de notification est toujours un chemin interne, jamais une adresse externe. */
  private safeRedirect(url: string | null): string | null {
    if (!url) return null;
    if (!url.startsWith('/') || url.startsWith('//')) {
      throw new Error(`redirectUrl doit être un chemin relatif du frontend : ${url}`);
    }
    return truncate(url, MAX_REDIRECT);
  }
}