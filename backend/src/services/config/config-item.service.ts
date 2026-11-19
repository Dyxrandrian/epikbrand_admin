import { QueryFailedError } from 'typeorm';
import type { DataSource } from 'typeorm';
import type { PaginationQueryDto } from '../../dto/index.js';
import { mapDto } from '../../dto/map-dto.js';
import { AuditAction } from '../../enums/audit.enums.js';
import type { AuditEntityType } from '../../enums/audit.enums.js';
import {
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
} from '../../exceptions/index.js';
import type {
  ConfigItemEntity,
  ConfigItemRepository,
  SluggableConfigItemRepository,
  SluggableEntity,
} from '../../repository/config-item.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import type { AuditService } from '../audit/audit.service.js';

/** Nombre d'essais de création si une contrainte d'unicité saute (deux créations simultanées). */
const MAX_CREATE_ATTEMPTS = 3;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

export abstract class ConfigItemService<
  T extends ConfigItemEntity,
  C extends object,
  U extends object,
> {
  protected abstract readonly entityType: AuditEntityType;
  protected abstract readonly auditFields: readonly string[];
  /** Champ de l'API -> propriété de l'entité, pour la modification. */
  protected abstract readonly updateMap: Readonly<Record<string, string>>;

  protected constructor(
    protected readonly dataSource: DataSource,
    protected readonly audit: AuditService,
    protected readonly repository: ConfigItemRepository<T>,
  ) {}

  protected abstract present(item: T): unknown;
  protected abstract buildCreateData(dto: C): Record<string, unknown>;
  protected abstract inUseMessage(count: number): string;

  /** Point d'extension : ajouter des valeurs calculées (ex. le slug) avant l'insertion. */
  protected prepareCreate(
    _repo: ConfigItemRepository<T>,
    _companyId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return Promise.resolve(data);
  }

  async list(companyId: string, query: PaginationQueryDto) {
    const result = await this.repository.list(companyId, query);
    return result.map((item) => this.present(item));
  }

  async create(admin: AuthenticatedUser, dto: C) {
    const data = this.buildCreateData(dto);
    const name = String(data.name);

    for (let attempt = 1; ; attempt++) {
      try {
        // Chaque essai est une transaction à part : une erreur SQL annule toute la transaction
        return await this.dataSource.transaction(async (manager) => {
          const repo = this.repository.withManager(manager);

          await this.assertNameFree(repo, admin.companyId, name);
          const prepared = await this.prepareCreate(repo, admin.companyId, data);

          const created = await repo.insertItem(admin.companyId, prepared);
          const item = await repo.getById(admin.companyId, created.id);

          await this.audit.record(
            {
              action: AuditAction.CREATE,
              entityType: this.entityType,
              entityId: item.id,
              companyId: admin.companyId,
              userId: admin.id,
              changes: { after: snapshot(item, this.auditFields) },
            },
            manager,
          );
          return this.present(item);
        });
      } catch (error) {
        // Collision de slug ou de nom avec une création simultanée : on réessaie.
        // Au nouvel essai, un nom pris donne un 409 clair, un slug pris reçoit un autre suffixe.
        if (attempt < MAX_CREATE_ATTEMPTS && isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  async update(admin: AuthenticatedUser, id: string, dto: U) {
    const changes = mapDto(dto, this.updateMap);

    return this.dataSource.transaction(async (manager) => {
      const repo = this.repository.withManager(manager);
      const before = await repo.getById(admin.companyId, id);

      if (typeof changes.name === 'string') {
        await this.assertNameFree(repo, admin.companyId, changes.name, id);
      }
      if (Object.keys(changes).length === 0) return this.present(before);

      const after = await repo.changeItem(admin.companyId, id, changes);

      const diff = diffChanges(before, after, this.auditFields);
      if (diff) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: this.entityType,
            entityId: id,
            companyId: admin.companyId,
            userId: admin.id,
            changes: diff,
          },
          manager,
        );
      }
      return this.present(after);
    });
  }

  /**
   * Supprime l'élément s'il n'est plus utilisé. S'il l'est : 409, sauf si `reassignTo`
   * désigne un autre élément vers lequel déplacer les objets rattachés (même transaction).
   */
  async remove(admin: AuthenticatedUser, id: string, reassignTo?: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = this.repository.withManager(manager);

      // Le verrou empêche qu'un objet se rattache à l'élément pendant sa suppression
      const item = await repo.lockById(admin.companyId, id);
      const usage = await repo.countUsage(admin.companyId, id);

      if (usage > 0) {
        if (!reassignTo) {
          throw new ConflictAppException(this.inUseMessage(usage), ErrorCode.REFERENCE_CONFLICT);
        }
        if (reassignTo === id) {
          throw new BusinessRuleException(
            "L'élément de remplacement doit être différent de celui que vous supprimez.",
          );
        }
        await repo.assertReference(admin.companyId, reassignTo, 'reassign_to');
        await repo.reassignUsage(admin.companyId, id, reassignTo);
      }

      const before = snapshot(item, this.auditFields);
      await repo.deleteById(admin.companyId, id);

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entityType: this.entityType,
          entityId: id,
          companyId: admin.companyId,
          userId: admin.id,
          changes:
            usage > 0 && reassignTo
              ? { before, after: { reassigned_to: reassignTo, reassigned_items: usage } }
              : { before },
        },
        manager,
      );
    });
  }

  private async assertNameFree(
    repo: ConfigItemRepository<T>,
    companyId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    if (await repo.nameTaken(companyId, name, excludeId)) {
      throw new ConflictAppException(
        `Le nom « ${name} » est déjà utilisé.`,
        ErrorCode.DUPLICATE_RESOURCE,
      );
    }
  }
}

/** Pour les ressources qui ont un slug généré automatiquement à la création. */
export abstract class SluggableConfigItemService<
  T extends SluggableEntity,
  C extends object,
  U extends object,
> extends ConfigItemService<T, C, U> {
  protected override async prepareCreate(
    repo: ConfigItemRepository<T>,
    companyId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const slug = await (repo as SluggableConfigItemRepository<T>).generateSlug(
      companyId,
      String(data.name),
    );
    return { ...data, slug };
  }
}