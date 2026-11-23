import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { PaginatedResult, toSkipTake } from '../dto/index.js';
import type { PageQueryDto } from '../dto/index.js';
import { AgencyArticleVersion } from '../entities/agency-article-version.entity.js';
import { ResourceNotFoundException } from '../exceptions/index.js';

/** Historique d'un article de l'entreprise : toujours atteint par l'article, jamais seul. */
@Injectable()
export class ArticleVersionRepository {
  constructor(
    @InjectRepository(AgencyArticleVersion) private readonly repo: Repository<AgencyArticleVersion>,
  ) {}

  private requireCompany(companyId: string): string {
    if (typeof companyId !== 'string' || companyId.length === 0) {
      throw new Error('companyId obligatoire.');
    }
    return companyId;
  }

  /** Versions précédentes, de la plus récente à la plus ancienne, sans leur contenu. */
  async list(
    companyId: string,
    articleId: string,
    query: PageQueryDto,
  ): Promise<PaginatedResult<AgencyArticleVersion>> {
    const qb = this.repo
      .createQueryBuilder('ver')
      .select(['ver.id', 'ver.articleId', 'ver.version', 'ver.title', 'ver.editedById', 'ver.createdAt'])
      .innerJoin('ver.article', 'art')
      .leftJoin('ver.editedBy', 'inc_editor')
      .addSelect(['inc_editor.id', 'inc_editor.name'])
      .where('art.companyId = :vCompany', { vCompany: this.requireCompany(companyId) })
      .andWhere('ver.articleId = :vArticle', { vArticle: articleId })
      .orderBy('ver.version', 'DESC');

    const { skip, take } = toSkipTake(query);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return new PaginatedResult(items, total, query.page, query.per_page);
  }

  /** Une version avec son contenu ; 404 si elle n'existe pas pour cet article de l'entreprise. */
  async get(
    companyId: string,
    articleId: string,
    version: number,
    manager?: EntityManager,
  ): Promise<AgencyArticleVersion> {
    const found = await (manager ?? this.repo.manager)
      .getRepository(AgencyArticleVersion)
      .createQueryBuilder('ver')
      .innerJoin('ver.article', 'art')
      .leftJoin('ver.editedBy', 'inc_editor')
      .addSelect(['inc_editor.id', 'inc_editor.name'])
      .where('art.companyId = :vCompany', { vCompany: this.requireCompany(companyId) })
      .andWhere('ver.articleId = :vArticle', { vArticle: articleId })
      .andWhere('ver.version = :vVersion', { vVersion: version })
      .getOne();
    if (!found) throw new ResourceNotFoundException('Version');
    return found;
  }

  /**
   * Conserve l'état actuel de l'article (titre, contenu, auteur, date) sous son numéro de version.
   * À appeler dans la transaction, avant la modification.
   */
  async snapshot(manager: EntityManager, companyId: string, articleId: string): Promise<void> {
    await manager.query(
      `INSERT INTO agency_article_versions (article_id, version, title, content, edited_by, created_at)
       SELECT a.id, a.version, a.title, a.content, a.updated_by, a.updated_at
         FROM agency_articles a
        WHERE a.company_id = $1 AND a.id = $2
       ON CONFLICT (article_id, version) DO NOTHING`,
      [this.requireCompany(companyId), articleId],
    );
  }

  /** Ne garde que les `keep` versions les plus récentes. */
  async prune(
    manager: EntityManager,
    companyId: string,
    articleId: string,
    keep: number,
  ): Promise<void> {
    await manager.query(
      `DELETE FROM agency_article_versions v
        USING agency_articles a
        WHERE v.article_id = a.id AND a.company_id = $1 AND a.id = $2
          AND v.id IN (SELECT id FROM agency_article_versions
                        WHERE article_id = $2 ORDER BY version DESC OFFSET $3)`,
      [this.requireCompany(companyId), articleId, keep],
    );
  }
}