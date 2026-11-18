import { IsNull, Not } from 'typeorm';
import type { FindOptionsWhere, SelectQueryBuilder } from 'typeorm';
import { ResourceNotFoundException } from '../exceptions/index.js';
import type { UpdateChanges } from './tenant.repository.js';
import { VersionedTenantRepository } from './versioned-tenant.repository.js';
import type { VersionedEntity } from './versioned-tenant.repository.js';

export type ArchiveFilter = 'exclude' | 'include' | 'only';

export interface ArchivableEntity extends VersionedEntity {
  archivedAt: Date | null;
}

export abstract class ArchivableTenantRepository<
  T extends ArchivableEntity,
> extends VersionedTenantRepository<T> {
  /** Par défaut, les éléments archivés sont exclus de toute lecture. */
  protected override scoped(
    companyId: string,
    options: { archived?: ArchiveFilter } = {},
  ): SelectQueryBuilder<T> {
    const qb = super.scoped(companyId);
    const mode = options.archived ?? 'exclude';
    if (mode === 'exclude') qb.andWhere(`${this.alias}.archivedAt IS NULL`);
    if (mode === 'only') qb.andWhere(`${this.alias}.archivedAt IS NOT NULL`);
    return qb;
  }

  protected override writableCriteria(
    companyId: string,
    id: string,
    extra: object = {},
  ): FindOptionsWhere<T> {
    return this.criteria(companyId, id, { ...extra, archivedAt: IsNull() });
  }

  async getByIdIncludingArchived(companyId: string, id: string): Promise<T> {
    const entity = await this.scoped(companyId, { archived: 'include' })
      .andWhere(`${this.alias}.id = :id`, { id })
      .getOne();
    if (!entity) throw new ResourceNotFoundException(this.label);
    return entity;
  }

  /** Idempotent : archiver un élément déjà archivé ne fait rien. */
  async archive(companyId: string, id: string): Promise<void> {
    await this.getByIdIncludingArchived(companyId, id);
    await this.repo.update(
      this.criteria(companyId, id, { archivedAt: IsNull() }),
      { archivedAt: new Date() } as unknown as UpdateChanges<T>,
    );
  }

  async restore(companyId: string, id: string): Promise<void> {
    await this.getByIdIncludingArchived(companyId, id);
    await this.repo.update(
      this.criteria(companyId, id, { archivedAt: Not(IsNull()) }),
      { archivedAt: null } as unknown as UpdateChanges<T>,
    );
  }
}