import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ArticleListQueryDto, CreateArticleDto, UpdateArticleDto } from '../../dto/articles/article.dto.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  AccessDeniedException,
  ConflictAppException,
  ErrorCode,
  ValidationFailedException,
} from '../../exceptions/index.js';
import { toArticle, toArticleDetail } from '../../mapper/article.mapper.js';
import {
  ArticleCategoryRepository,
  ArticleSectionRepository,
} from '../../repository/config-lists.repositories.js';
import { ArticleRepository } from '../../repository/article.repository.js';
import { ArticleVersionRepository } from '../../repository/article-version.repository.js';
import { FileRepository } from '../../repository/file.repository.js';
import { slugify } from '../../repository/slug.js';
import { isManagerOrAdmin } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { ARTICLE_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { FileStorage } from '../files/storage/file-storage.js';
import { notificationTemplates } from '../notifications/notification-templates.js';
import { NotificationService } from '../notifications/notification.service.js';
import { blocksToMarkdown } from './article-markdown.js';
import { parseStoredContent } from './article-blocks.js';
import { ArticleContentService } from './article-content.service.js';
import { MAX_VERSIONS_KEPT, staleVersion } from './article-rules.js';

@Injectable()
export class ArticleService {
  private readonly logger = new Logger(ArticleService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly articles: ArticleRepository,
    private readonly versions: ArticleVersionRepository,
    private readonly sections: ArticleSectionRepository,
    private readonly categories: ArticleCategoryRepository,
    private readonly contents: ArticleContentService,
    private readonly files: FileRepository,
    private readonly storage: FileStorage,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------- Lectures ----------

  async list(viewer: AuthenticatedUser, query: ArticleListQueryDto) {
    const archived = query.archived ?? 'exclude';
    if (!isManagerOrAdmin(viewer) && archived !== 'exclude') {
      throw new AccessDeniedException(
        'Le filtre archived est réservé aux administrateurs et managers.',
      );
    }
    if (query.category_id !== undefined && query.uncategorized === true) {
      throw new ValidationFailedException([
        {
          field: 'uncategorized',
          reason: 'filterConflict',
          message: 'category_id et uncategorized=true sont incompatibles.',
        },
      ]);
    }

    const result = await this.articles.list(viewer.companyId, query, archived, {
      sectionId: query.section_id,
      categoryId: query.category_id,
      uncategorized: query.uncategorized,
      updatedBy: query.updated_by,
    });
    const excerpts = await this.articles.excerpts(
      viewer.companyId,
      result.items.map((article) => article.id),
    );
    return result.map((article) => toArticle(article, excerpts.get(article.id) ?? ''));
  }

  navigation(viewer: AuthenticatedUser) {
    return this.articles.navigation(viewer.companyId);
  }

  /** 404 si l'article n'existe pas, est d'une autre entreprise, ou archivé pour un collaborateur. */
  async get(viewer: AuthenticatedUser, id: string) {
    const article = await this.articles.getDetailed(viewer.companyId, id, isManagerOrAdmin(viewer));
    return toArticleDetail(article);
  }

  async exportMarkdown(viewer: AuthenticatedUser, id: string) {
    const article = await this.articles.getDetailed(viewer.companyId, id, isManagerOrAdmin(viewer));
    const body = blocksToMarkdown(parseStoredContent(article.content));
    return {
      markdown: `# ${article.title}\n\n${body}`,
      fileName: `${slugify(article.title)}.md`,
    };
  }

  // ---------- Écritures ----------

  async create(user: AuthenticatedUser, dto: CreateArticleDto) {
    const { companyId } = user;
    // Sans image : elles ne peuvent être jointes qu'à un article existant
    const prepared = await this.contents.prepare(null, companyId, null, dto.content ?? [], 'strict');

    const created = await this.dataSource.transaction(async (manager) => {
      await this.sections.withManager(manager).assertReference(companyId, dto.section_id, 'section_id');
      if (dto.category_id) {
        await this.categories
          .withManager(manager)
          .assertReference(companyId, dto.category_id, 'category_id');
      }

      const repo = this.articles.withManager(manager);
      const inserted = await repo.insertArticle(companyId, {
        title: dto.title,
        content: prepared.json,
        searchText: prepared.plainText,
        sectionId: dto.section_id,
        categoryId: dto.category_id ?? null,
        updatedById: user.id,
      });
      const article = await repo.getById(companyId, inserted.id);

      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.ARTICLE,
          entityId: article.id,
          companyId,
          userId: user.id,
          changes: { after: snapshot(article, ARTICLE_AUDIT_FIELDS) },
        },
        manager,
      );
      return article;
    });

    if (dto.notify !== false) {
      await this.notifications.notify({
        companyId,
        recipientIds: await this.notifications.activeUserIds(companyId),
        actorId: user.id,
        ...notificationTemplates.articlePublished(
          { id: created.id, title: created.title },
          user.name,
        ),
      });
    }
    return this.get(user, created.id);
  }

  /**
   * Verrouillage optimiste : `version` doit être celle lue (409 sinon). Un changement de titre ou de
   * contenu conserve d'abord l'état précédent dans l'historique ; l'auteur et la date sont mis à jour.
   */
  async update(user: AuthenticatedUser, id: string, dto: UpdateArticleDto) {
    const { companyId } = user;

    await this.dataSource.transaction(async (manager) => {
      const repo = this.articles.withManager(manager);
      const before = await repo.lockById(companyId, id); // 404 si archivé ou étranger
      if (before.version !== dto.version) throw staleVersion();

      const changes: Record<string, unknown> = {};

      const titleChanged = dto.title !== undefined && dto.title !== before.title;
      if (titleChanged) changes.title = dto.title;

      if (dto.section_id !== undefined && dto.section_id !== before.sectionId) {
        await this.sections.withManager(manager).assertReference(companyId, dto.section_id, 'section_id');
        changes.sectionId = dto.section_id;
      }
      if (dto.category_id !== undefined && dto.category_id !== before.categoryId) {
        if (dto.category_id !== null) {
          await this.categories
            .withManager(manager)
            .assertReference(companyId, dto.category_id, 'category_id');
        }
        changes.categoryId = dto.category_id;
      }

      let contentChanged = false;
      if (dto.content !== undefined) {
        const prepared = await this.contents.prepare(manager, companyId, id, dto.content, 'strict');
        if (prepared.json !== before.content) {
          changes.content = prepared.json;
          changes.searchText = prepared.plainText;
          contentChanged = true;
        }
      }

      if (Object.keys(changes).length === 0) return; // rien à enregistrer : version inchangée

      if (titleChanged || contentChanged) {
        await this.versions.snapshot(manager, companyId, id);
        await this.versions.prune(manager, companyId, id, MAX_VERSIONS_KEPT);
      }
      changes.updatedById = user.id;

      const after = await repo.changeWithVersion(companyId, id, dto.version, changes);

      const diff = diffChanges(before, after, ARTICLE_AUDIT_FIELDS);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.ARTICLE,
          entityId: id,
          companyId,
          userId: user.id,
          changes: {
            before: diff?.before ?? {},
            after: { ...(diff?.after ?? {}), ...(contentChanged ? { content_changed: true } : {}) },
          },
        },
        manager,
      );
    });

    return this.get(user, id);
  }

  /** Idempotent : archiver un article déjà archivé ne fait rien. */
  async archive(admin: AuthenticatedUser, id: string) {
    const { companyId } = admin;

    await this.dataSource.transaction(async (manager) => {
      const repo = this.articles.withManager(manager);
      const before = await repo.getByIdIncludingArchived(companyId, id);
      if (before.archivedAt) return;

      await repo.archive(companyId, id);
      await this.audit.record(
        {
          action: AuditAction.ARCHIVE,
          entityType: AuditEntityType.ARTICLE,
          entityId: id,
          companyId,
          userId: admin.id,
        },
        manager,
      );
    });
    return this.get(admin, id);
  }

  /** Idempotent : restaurer un article actif ne fait rien. */
  async restore(admin: AuthenticatedUser, id: string) {
    const { companyId } = admin;

    await this.dataSource.transaction(async (manager) => {
      const repo = this.articles.withManager(manager);
      const before = await repo.getByIdIncludingArchived(companyId, id);
      if (!before.archivedAt) return;

      await repo.restore(companyId, id);
      await this.audit.record(
        {
          action: AuditAction.RESTORE,
          entityType: AuditEntityType.ARTICLE,
          entityId: id,
          companyId,
          userId: admin.id,
        },
        manager,
      );
    });
    return this.get(admin, id);
  }

  /** Suppression définitive : seulement un article archivé. Versions et fichiers partent avec lui. */
  async remove(admin: AuthenticatedUser, id: string): Promise<void> {
    const { companyId } = admin;

    const keys = await this.dataSource.transaction(async (manager) => {
      const repo = this.articles.withManager(manager);
      const article = await repo.lockByIdIncludingArchived(companyId, id);
      if (!article.archivedAt) {
        throw new ConflictAppException(
          "Archivez l'article avant de le supprimer définitivement.",
          ErrorCode.INVALID_STATE,
        );
      }

      const fileKeys = await this.files.withManager(manager).keysOfArticle(companyId, id);
      const before = snapshot(article, ARTICLE_AUDIT_FIELDS);
      await repo.deleteById(companyId, id);

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entityType: AuditEntityType.ARTICLE,
          entityId: id,
          companyId,
          userId: admin.id,
          changes: { before: { ...before, files_count: fileKeys.length } },
        },
        manager,
      );
      return fileKeys;
    });

    // Les objets du stockage sont supprimés seulement une fois la transaction validée
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        this.logger.error(`Suppression de l'objet de stockage impossible : ${key}`, error as Error);
      }
    }
  }
}