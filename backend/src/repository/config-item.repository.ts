import type { DeepPartial } from 'typeorm';
import type { PaginatedResult, PaginationQueryDto, SortOrder } from '../dto/index.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { applyWordSearch, escapeLike } from './search.js';
import { slugify, uniqueSlug } from './slug.js';
import { TenantRepository } from './tenant.repository.js';
import type { TenantEntity, UpdateChanges } from './tenant.repository.js';

export interface ConfigItemEntity extends TenantEntity {
  name: string;
}

export interface SluggableEntity extends ConfigItemEntity {
  slug: string;
}

export abstract class ConfigItemRepository<
  T extends ConfigItemEntity,
> extends TenantRepository<T> {
  protected readonly sortableFields = { name: 'name' };
  protected readonly defaultSort: SortOrder = { name: 'ASC' };

  list(companyId: string, query: PaginationQueryDto): Promise<PaginatedResult<T>> {
    const qb = this.scoped(companyId);
    this.applyIncludes(qb, query.include, {}); // aucune relation disponible : include est refusé
    applyWordSearch(qb, `"${this.alias}"."name"`, query.q);
    return this.paginate(qb, query);
  }

  /** Nom déjà pris dans l'entreprise ? Insensible à la casse et aux accents. */
  async nameTaken(companyId: string, name: string, excludeId?: string): Promise<boolean> {
    const qb = this.scoped(companyId).andWhere(
      `immutable_unaccent(lower("${this.alias}"."name")) = immutable_unaccent(lower(CAST(:candidateName AS text)))`,
      { candidateName: name },
    );
    if (excludeId) qb.andWhere(`"${this.alias}"."id" <> :excludeId`, { excludeId });
    return qb.getExists();
  }

  /** Lecture avec verrou (FOR UPDATE) : uniquement dans une transaction, via withManager(). */
  async lockById(companyId: string, id: string): Promise<T> {
    const item = await this.scoped(companyId)
      .andWhere(`${this.alias}.id = :id`, { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!item) throw new ResourceNotFoundException(this.label);
    return item;
  }

  insertItem(companyId: string, data: Record<string, unknown>): Promise<T> {
    return this.createOne(companyId, data as unknown as Omit<DeepPartial<T>, 'id' | 'companyId'>);
  }

  changeItem(companyId: string, id: string, changes: Record<string, unknown>): Promise<T> {
    return this.updateById(companyId, id, changes as unknown as UpdateChanges<T>);
  }

  /** Nombre d'objets rattachés à cet élément (tous statuts confondus, archivés compris). */
  abstract countUsage(companyId: string, id: string): Promise<number>;

  /**
   * Déplace les objets rattachés vers `toId`.
   * `toId` a déjà été vérifié comme appartenant à l'entreprise par le service.
   */
  reassignUsage(_companyId: string, _fromId: string, _toId: string): Promise<void> {
    return Promise.reject(new Error('Réaffectation non prise en charge pour cette ressource.'));
  }

  protected async countRows(sql: string, params: unknown[]): Promise<number> {
    const rows: Array<{ n: number }> = await this.repo.manager.query(sql, params);
    return rows[0]?.n ?? 0;
  }
}

export abstract class SluggableConfigItemRepository<
  T extends SluggableEntity,
> extends ConfigItemRepository<T> {
  /** Slug libre dans l'entreprise, dérivé du nom. */
  async generateSlug(companyId: string, name: string): Promise<string> {
    const base = slugify(name);
    const rows = await this.scoped(companyId)
      .select(`${this.alias}.slug`, 'slug')
      .andWhere(`(${this.alias}.slug = :slugBase OR ${this.alias}.slug LIKE :slugPrefix)`, {
        slugBase: base,
        slugPrefix: `${escapeLike(base)}-%`,
      })
      .getRawMany<{ slug: string }>();
    return uniqueSlug(base, rows.map((row) => row.slug));
  }
}