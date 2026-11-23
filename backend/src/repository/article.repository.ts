import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { AgencyArticle } from '../entities/agency-article.entity.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { ArchivableTenantRepository } from './archivable-tenant.repository.js';
import type { ArchiveFilter } from './archivable-tenant.repository.js';
import { escapeLike, searchWords } from './search.js';
import type { UpdateChanges } from './tenant.repository.js';

export interface ArticleFilters {
  sectionId?: string;
  categoryId?: string;
  uncategorized?: boolean;
  updatedBy?: string;
}

export interface NavigationEntry {
  id: string;
  name: string;
  slug: string;
  count: number;
}

export interface ArticleNavigation {
  sections: NavigationEntry[];
  categories: NavigationEntry[];
  total: number;
  uncategorized: number;
}

/** La liste ne charge jamais le contenu (jusqu'à 1 Mo par article). */
const LIST_COLUMNS = [
  'article.id',
  'article.title',
  'article.sectionId',
  'article.categoryId',
  'article.updatedById',
  'article.archivedAt',
  'article.version',
  'article.createdAt',
  'article.updatedAt',
];

@Injectable()
export class ArticleRepository extends ArchivableTenantRepository<AgencyArticle> {
  protected readonly alias = 'article';
  protected readonly label = 'Article';
  protected readonly sortableFields = {
    title: 'title',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
  };
  protected readonly defaultSort: SortOrder = { updated_at: 'DESC' };

  constructor(@InjectRepository(AgencyArticle) repo: Repository<AgencyArticle>) {
    super(repo);
  }

  // ---------- Lectures ----------

  list(
    companyId: string,
    query: PaginationQueryDto,
    archived: ArchiveFilter,
    filters: ArticleFilters,
  ) {
    const qb = this.scoped(companyId, { archived })
      .select(LIST_COLUMNS)
      .leftJoin('article.section', 'inc_section')
      .addSelect(['inc_section.id', 'inc_section.name', 'inc_section.slug'])
      .leftJoin('article.category', 'inc_category')
      .addSelect(['inc_category.id', 'inc_category.name', 'inc_category.slug'])
      .leftJoin('article.updatedBy', 'inc_updater')
      .addSelect(['inc_updater.id', 'inc_updater.name', 'inc_updater.avatarUrl']);
    this.applyIncludes(qb, query.include, {}); // section, catégorie et auteur sont toujours inclus

    if (filters.sectionId) qb.andWhere('article.sectionId = :fSection', { fSection: filters.sectionId });
    if (filters.categoryId) qb.andWhere('article.categoryId = :fCategory', { fCategory: filters.categoryId });
    if (filters.uncategorized) qb.andWhere('article.categoryId IS NULL');
    if (filters.updatedBy) qb.andWhere('article.updatedById = :fUpdater', { fUpdater: filters.updatedBy });

    // Chaque mot doit apparaître dans le titre ou le contenu (index trigramme). Dès 4 lettres,
    // une faute de frappe est tolérée (word_similarity).
    searchWords(query.q).forEach((word, index) => {
      const exact = `aword_${index}`;
      const fuzzy = `afuzzy_${index}`;
      const typoTolerant =
        word.length >= 4
          ? ` OR f_unaccent(CAST(:${fuzzy} AS text)) <% f_unaccent("article"."title")
              OR f_unaccent(CAST(:${fuzzy} AS text)) <% f_unaccent("article"."search_text")`
          : '';
      qb.andWhere(
        `(f_unaccent("article"."title") ILIKE '%' || f_unaccent(CAST(:${exact} AS text)) || '%'
          OR f_unaccent("article"."search_text") ILIKE '%' || f_unaccent(CAST(:${exact} AS text)) || '%'${typoTolerant})`,
        { [exact]: escapeLike(word), [fuzzy]: word },
      );
    });
    return this.paginate(qb, query);
  }

  /** Article complet avec section, catégorie et dernier auteur (id, nom seulement). */
  async getDetailed(
    companyId: string,
    id: string,
    includeArchived: boolean,
  ): Promise<AgencyArticle> {
    const article = await this.scoped(companyId, { archived: includeArchived ? 'include' : 'exclude' })
      .leftJoin('article.section', 'inc_section')
      .addSelect(['inc_section.id', 'inc_section.name', 'inc_section.slug'])
      .leftJoin('article.category', 'inc_category')
      .addSelect(['inc_category.id', 'inc_category.name', 'inc_category.slug'])
      .leftJoin('article.updatedBy', 'inc_updater')
      .addSelect(['inc_updater.id', 'inc_updater.name', 'inc_updater.avatarUrl'])
      .andWhere('article.id = :artId', { artId: id })
      .getOne();
    if (!article) throw new ResourceNotFoundException(this.label);
    return article;
  }

  /** Verrouille l'article actif jusqu'à la fin de la transaction (via withManager()). */
  async lockById(companyId: string, id: string): Promise<AgencyArticle> {
    const article = await this.scoped(companyId)
      .andWhere('article.id = :lockId', { lockId: id })
      .setLock('pessimistic_write')
      .getOne();
    if (!article) throw new ResourceNotFoundException(this.label);
    return article;
  }

  async lockByIdIncludingArchived(companyId: string, id: string): Promise<AgencyArticle> {
    const article = await this.scoped(companyId, { archived: 'include' })
      .andWhere('article.id = :lockId', { lockId: id })
      .setLock('pessimistic_write')
      .getOne();
    if (!article) throw new ResourceNotFoundException(this.label);
    return article;
  }

  /** Premiers caractères du texte brut, pour la liste (une seule requête pour toute la page). */
  async excerpts(companyId: string, ids: readonly string[]): Promise<Map<string, string>> {
    const excerpts = new Map<string, string>();
    if (ids.length === 0) return excerpts;

    const rows: Array<{ id: string; excerpt: string }> = await this.repo.manager.query(
      `SELECT id, btrim(regexp_replace(left(search_text, 240), '\\s+', ' ', 'g')) AS excerpt
         FROM agency_articles
        WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [this.requireCompanyId(companyId), [...ids]],
    );
    for (const row of rows) excerpts.set(row.id, row.excerpt);
    return excerpts;
  }

  /** Sections et catégories avec le nombre d'articles actifs. */
  async navigation(companyId: string): Promise<ArticleNavigation> {
    const company = this.requireCompanyId(companyId);
    const entries = (table: string, joinColumn: string): Promise<NavigationEntry[]> =>
      this.repo.manager.query(
        `SELECT t.id, t.name, t.slug, COUNT(a.id)::int AS count
           FROM ${table} t
           LEFT JOIN agency_articles a
                  ON a.${joinColumn} = t.id AND a.company_id = t.company_id AND a.archived_at IS NULL
          WHERE t.company_id = $1
          GROUP BY t.id, t.name, t.slug
          ORDER BY t.name ASC, t.id ASC`,
        [company],
      );

    const [sections, categories, totals] = await Promise.all([
      entries('article_sections', 'section_id'),
      entries('article_categories', 'category_id'),
      this.repo.manager.query(
        `SELECT COUNT(*)::int AS total,
                (COUNT(*) FILTER (WHERE category_id IS NULL))::int AS uncategorized
           FROM agency_articles
          WHERE company_id = $1 AND archived_at IS NULL`,
        [company],
      ) as Promise<Array<{ total: number; uncategorized: number }>>,
    ]);
    return { sections, categories, total: totals[0].total, uncategorized: totals[0].uncategorized };
  }

  // ---------- Écritures ----------

  insertArticle(companyId: string, data: Record<string, unknown>): Promise<AgencyArticle> {
    return this.createOne(companyId, data as never);
  }

  changeWithVersion(
    companyId: string,
    id: string,
    version: number,
    changes: Record<string, unknown>,
  ): Promise<AgencyArticle> {
    return this.updateWithVersion(
      companyId,
      id,
      version,
      changes as unknown as UpdateChanges<AgencyArticle>,
    );
  }
}