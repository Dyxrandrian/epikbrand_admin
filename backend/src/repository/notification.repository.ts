import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial, FindOptionsWhere } from 'typeorm';
import type { SortOrder } from '../dto/index.js';
import type { NotificationListQueryDto } from '../dto/notifications/notification-list-query.dto.js';
import { Notification } from '../entities/notification.entity.js';
import { UserPreferences } from '../entities/user-preferences.entity.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { TenantRepository } from './tenant.repository.js';
import type { UpdateChanges } from './tenant.repository.js';

export interface NewNotification {
  userId: string;
  type: string;
  title: string;
  content: string;
  redirectUrl: string | null;
}

export interface NotificationRecipient {
  id: string;
  name: string;
  email: string;
  prefs: Record<string, unknown>;
}

/** Notifications : toujours filtrées par entreprise ET par destinataire. */
@Injectable()
export class NotificationRepository extends TenantRepository<Notification> {
  protected readonly alias = 'ntf';
  protected readonly label = 'Notification';
  protected readonly sortableFields = { created_at: 'createdAt' };
  protected readonly defaultSort: SortOrder = { created_at: 'DESC' };

  constructor(@InjectRepository(Notification) repo: Repository<Notification>) {
    super(repo);
  }

  list(companyId: string, userId: string, query: NotificationListQueryDto) {
    const qb = this.scoped(companyId).andWhere('ntf.userId = :ntfUser', { ntfUser: userId });
    if (query.is_read !== undefined) {
      qb.andWhere('ntf.isRead = :ntfRead', { ntfRead: query.is_read });
    }
    if (query.type) qb.andWhere('ntf.type = :ntfType', { ntfType: query.type });
    return this.paginate(qb, query);
  }

  unreadCount(companyId: string, userId: string): Promise<number> {
    return this.scoped(companyId)
      .andWhere('ntf.userId = :ntfUser', { ntfUser: userId })
      .andWhere('ntf.isRead = false')
      .getCount();
  }

  /** Compteurs de non-lues de plusieurs utilisateurs (une requête). */
  async unreadCounts(companyId: string, userIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (userIds.length === 0) return counts;

    const rows: Array<{ user_id: string; n: number }> = await this.repo.manager.query(
      `SELECT user_id, COUNT(*)::int AS n
         FROM notifications
        WHERE company_id = $1 AND is_read = false AND user_id = ANY($2::uuid[])
        GROUP BY user_id`,
      [companyId, [...userIds]],
    );
    for (const row of rows) counts.set(row.user_id, row.n);
    return counts;
  }

  /** 404 si la notification n'existe pas, n'est pas à cet utilisateur ou est d'une autre entreprise. */
  async getOwned(companyId: string, userId: string, id: string): Promise<Notification> {
    const item = await this.scoped(companyId)
      .andWhere('ntf.userId = :ntfUser', { ntfUser: userId })
      .andWhere('ntf.id = :ntfId', { ntfId: id })
      .getOne();
    if (!item) throw new ResourceNotFoundException(this.label);
    return item;
  }

  /** Idempotent : marquer comme lue une notification déjà lue ne change rien. */
  async markRead(companyId: string, userId: string, id: string): Promise<Notification> {
    const existing = await this.getOwned(companyId, userId, id);
    if (!existing.isRead) {
      await this.repo.update(
        this.criteria(companyId, id, { userId, isRead: false }),
        { isRead: true, readAt: new Date() } as UpdateChanges<Notification>,
      );
    }
    return this.getOwned(companyId, userId, id);
  }

  /** Renvoie le nombre de notifications passées à « lue ». */
  async markAllRead(companyId: string, userId: string): Promise<number> {
    this.assertCompany(companyId);
    const result = await this.repo.update(
      { companyId, userId, isRead: false } as unknown as FindOptionsWhere<Notification>,
      { isRead: true, readAt: new Date() } as UpdateChanges<Notification>,
    );
    return result.affected ?? 0;
  }

  async deleteOwned(companyId: string, userId: string, id: string): Promise<void> {
    const result = await this.repo.delete(this.criteria(companyId, id, { userId }));
    if (!result.affected) throw new ResourceNotFoundException(this.label);
  }

  async insertMany(companyId: string, rows: readonly NewNotification[]): Promise<Notification[]> {
    this.assertCompany(companyId);
    if (rows.length === 0) return [];

    const entities = this.repo.create(
      rows.map((row) => ({
        ...row,
        companyId,
        isRead: false,
        readAt: null,
      })) as DeepPartial<Notification>[],
    );
    return this.repo.save(entities);
  }

  /**
   * Destinataires possibles : utilisateurs ACTIFS de cette entreprise, avec leurs préférences.
   * C'est le garde-fou multi-tenant des notifications.
   */
  findRecipients(companyId: string, userIds: readonly string[]): Promise<NotificationRecipient[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.repo.manager.query(
      `SELECT u.id,
              u.name,
              u.email::text AS email,
              COALESCE(p.notification_prefs, '{}'::jsonb) AS prefs
         FROM users u
         LEFT JOIN user_preferences p ON p.user_id = u.id
        WHERE u.company_id = $1
          AND u.is_active = true
          AND u.id = ANY($2::uuid[])`,
      [companyId, [...userIds]],
    );
  }

  private assertCompany(companyId: string): void {
    if (typeof companyId !== 'string' || companyId.length === 0) {
      throw new Error('companyId obligatoire : les notifications sont cloisonnées par entreprise.');
    }
  }

  /** Administrateurs et managers actifs de l'entreprise. */
  async managerIds(companyId: string): Promise<string[]> {
    this.assertCompany(companyId);
    const rows: Array<{ id: string }> = await this.repo.manager.query(
      `SELECT id FROM users
        WHERE company_id = $1 AND is_active = true AND role IN ('admin', 'manager')`,
      [companyId],
    );
    return rows.map((row) => row.id);
  }
}

/** Préférences : table personnelle, filtrée sur user_id (tiré du jeton). */
@Injectable()
export class NotificationPreferencesRepository {
  constructor(
    @InjectRepository(UserPreferences) private readonly repo: Repository<UserPreferences>,
  ) { }

  async get(userId: string): Promise<Record<string, unknown>> {
    const rows: Array<{ notification_prefs: Record<string, unknown> }> =
      await this.repo.manager.query(
        'SELECT notification_prefs FROM user_preferences WHERE user_id = $1',
        [userId],
      );
    return rows[0]?.notification_prefs ?? {};
  }

  /** Fusionne les choix (atomique) ; crée la ligne si elle n'existe pas encore. */
  async merge(userId: string, patch: Record<string, boolean>): Promise<void> {
    await this.repo.manager.query(
      `INSERT INTO user_preferences (user_id, notification_prefs)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE
         SET notification_prefs = user_preferences.notification_prefs || EXCLUDED.notification_prefs,
             updated_at = now()`,
      [userId, JSON.stringify(patch)],
    );
  }
}