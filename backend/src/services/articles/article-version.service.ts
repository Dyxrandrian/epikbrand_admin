import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { PageQueryDto } from '../../dto/index.js';
import type { RestoreVersionDto } from '../../dto/articles/article.dto.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  toArticleVersionDetail,
  toArticleVersionSummary,
} from '../../mapper/article.mapper.js';
import { ArticleRepository } from '../../repository/article.repository.js';
import { ArticleVersionRepository } from '../../repository/article-version.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges } from '../audit/audit-changes.js';
import { ARTICLE_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { parseStoredContent } from './article-blocks.js';
import { ArticleContentService } from './article-content.service.js';
import { MAX_VERSIONS_KEPT, staleVersion } from './article-rules.js';
import { ArticleService } from './article.service.js';

@Injectable()
export class ArticleVersionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly articles: ArticleRepository,
    private readonly versions: ArticleVersionRepository,
    private readonly contents: ArticleContentService,
    private readonly articleService: ArticleService,
    private readonly audit: AuditService,
  ) {}

  /** Versions précédentes (la version courante est l'article lui-même). */
  async list(viewer: AuthenticatedUser, articleId: string, query: PageQueryDto) {
    await this.articles.getByIdIncludingArchived(viewer.companyId, articleId); // 404
    const result = await this.versions.list(viewer.companyId, articleId, query);
    return result.map(toArticleVersionSummary);
  }

  async get(viewer: AuthenticatedUser, articleId: string, version: number) {
    await this.articles.getByIdIncludingArchived(viewer.companyId, articleId); // 404
    return toArticleVersionDetail(await this.versions.get(viewer.companyId, articleId, version));
  }

  /**
   * Restaure une ancienne version comme nouvelle version : l'état courant est d'abord conservé.
   * Les images qui n'existent plus sont retirées du contenu (`dropped_images`).
   */
  async restore(user: AuthenticatedUser, articleId: string, version: number, dto: RestoreVersionDto) {
    const { companyId } = user;

    const droppedImages = await this.dataSource.transaction(async (manager) => {
      const repo = this.articles.withManager(manager);
      const before = await repo.lockById(companyId, articleId); // 404 si archivé ou étranger
      if (before.version !== dto.version) throw staleVersion();

      const target = await this.versions.get(companyId, articleId, version, manager);
      const prepared = await this.contents.prepare(
        manager,
        companyId,
        articleId,
        parseStoredContent(target.content),
        'lenient',
      );
      if (target.title === before.title && prepared.json === before.content) {
        return prepared.droppedImages; // identique à l'état courant : rien à faire
      }

      await this.versions.snapshot(manager, companyId, articleId);
      await this.versions.prune(manager, companyId, articleId, MAX_VERSIONS_KEPT);

      const after = await repo.changeWithVersion(companyId, articleId, dto.version, {
        title: target.title,
        content: prepared.json,
        searchText: prepared.plainText,
        updatedById: user.id,
      });

      const diff = diffChanges(before, after, ARTICLE_AUDIT_FIELDS);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.ARTICLE,
          entityId: articleId,
          companyId,
          userId: user.id,
          changes: {
            before: diff?.before ?? {},
            after: {
              ...(diff?.after ?? {}),
              content_changed: true,
              restored_version: version,
              dropped_images: prepared.droppedImages,
            },
          },
        },
        manager,
      );
      return prepared.droppedImages;
    });

    return {
      ...(await this.articleService.get(user, articleId)),
      restored_version: version,
      dropped_images: droppedImages,
    };
  }
}