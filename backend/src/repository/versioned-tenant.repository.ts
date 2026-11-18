import { ConflictAppException, ErrorCode } from '../exceptions/index.js';
import { TenantRepository } from './tenant.repository.js';
import type { TenantEntity, UpdateChanges } from './tenant.repository.js';

export interface VersionedEntity extends TenantEntity {
  version: number;
}

export abstract class VersionedTenantRepository<
  T extends VersionedEntity,
> extends TenantRepository<T> {
  /**
   * Modifie seulement si la version envoyée est celle de la base.
   * 404 si la ressource n'existe pas pour cette entreprise, 409 si la version est périmée.
   */
  async updateWithVersion(
    companyId: string,
    id: string,
    expectedVersion: number,
    changes: UpdateChanges<T>,
  ): Promise<T> {
    const result = await this.repo.update(
      this.writableCriteria(companyId, id, { version: expectedVersion }),
      this.sanitize(changes),
    );
    if (result.affected) return this.getById(companyId, id);

    // 0 ligne modifiée : soit introuvable (404 ici), soit version périmée (409)
    await this.getById(companyId, id);
    throw new ConflictAppException(
      'Cette ressource a été modifiée entre-temps. Rechargez-la puis réessayez.',
      ErrorCode.VERSION_CONFLICT,
    );
  }
}