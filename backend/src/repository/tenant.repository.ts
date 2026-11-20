import type {
  DeepPartial,
  EntityManager,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { PaginatedResult, parseSort, toSkipTake } from '../dto/index.js';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import {
  InvalidReferenceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../exceptions/index.js';

export interface TenantEntity extends ObjectLiteral {
  id: string;
  companyId: string;
}

export type UpdateChanges<T extends ObjectLiteral> = Parameters<Repository<T>['update']>[1];

/** Champs qu'aucun appelant ne peut modifier via update (ils ont leurs méthodes dédiées). */
const PROTECTED_FIELDS = ['id', 'companyId', 'createdAt', 'version', 'archivedAt'] as const;

export abstract class TenantRepository<T extends TenantEntity> {
  /** Alias SQL des requêtes de ce repository. */
  protected abstract readonly alias: string;
  /** Nom affiché dans les erreurs : « Client introuvable. » */
  protected abstract readonly label: string;
  /** Champs triables : nom exposé par l'API -> propriété de l'entité. */
  protected abstract readonly sortableFields: Readonly<Record<string, string>>;
  /** Tri par défaut (clés = noms exposés par l'API). */
  protected abstract readonly defaultSort: SortOrder;

  constructor(protected repo: Repository<T>) {}

  // ---------- Point d'entrée unique des lectures ----------

  /**
   * Toute lecture commence ici : le filtre d'entreprise est posé d'office.
   * RÈGLE : à partir de cet objet, n'utiliser QUE andWhere(), jamais where()
   * (where() écraserait le filtre d'entreprise).
   */
  protected scoped(companyId: string): SelectQueryBuilder<T> {
    return this.repo
      .createQueryBuilder(this.alias)
      .where(`${this.alias}.companyId = :tenantCompanyId`, {
        tenantCompanyId: this.requireCompanyId(companyId),
      });
  }

  async findById(companyId: string, id: string): Promise<T | null> {
    return this.scoped(companyId).andWhere(`${this.alias}.id = :id`, { id }).getOne();
  }

  /** 404 si la ressource n'existe pas OU appartient à une autre entreprise. */
  async getById(companyId: string, id: string): Promise<T> {
    const entity = await this.findById(companyId, id);
    if (!entity) throw new ResourceNotFoundException(this.label);
    return entity;
  }

  async existsById(companyId: string, id: string): Promise<boolean> {
    return this.scoped(companyId).andWhere(`${this.alias}.id = :id`, { id }).getExists();
  }

  /**
   * Vérifie qu'un identifiant reçu dans un corps de requête (ex. client_id d'un projet)
   * désigne bien un objet de l'entreprise. Même erreur qu'il soit inexistant ou étranger.
   */
  async assertReference(companyId: string, id: string, field: string): Promise<void> {
    if (!(await this.existsById(companyId, id))) {
      throw new InvalidReferenceException(field, this.label);
    }
  }

  // ---------- Écritures ----------

  /** Le companyId passé en paramètre écrase toute valeur présente dans `data`. */
  async createOne(
    companyId: string,
    data: Omit<DeepPartial<T>, 'id' | 'companyId'>,
  ): Promise<T> {
    const entity = this.repo.create({
      ...data,
      companyId: this.requireCompanyId(companyId),
    } as unknown as DeepPartial<T>);
    return this.repo.save(entity);
  }

  async updateById(companyId: string, id: string, changes: UpdateChanges<T>): Promise<T> {
    const result = await this.repo.update(
      this.writableCriteria(companyId, id),
      this.sanitize(changes),
    );
    if (!result.affected) throw new ResourceNotFoundException(this.label);
    return this.getById(companyId, id);
  }

  /** Suppression définitive. Les services préfèrent l'archivage quand le contrat le prévoit. */
  async deleteById(companyId: string, id: string): Promise<void> {
    const result = await this.repo.delete(this.criteria(companyId, id));
    if (!result.affected) throw new ResourceNotFoundException(this.label);
  }

  /** Même repository, exécuté dans la transaction `manager`. */
  withManager(manager: EntityManager): this {
    const clone = Object.create(this) as this;
    clone.repo = manager.getRepository<T>(this.repo.target);
    return clone;
  }

  // ---------- Outils pour les repositories concrets ----------

  /**
   * Liste paginée. L'ordre se termine toujours par l'id : sans critère unique,
   * deux pages consécutives pourraient se chevaucher.
   * NB : le paramètre `q` (recherche) est branché avec l'index de recherche, au module Clients.
   */
  protected async paginate(
    qb: SelectQueryBuilder<T>,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<T>> {
    const order = parseSort(query.sort, Object.keys(this.sortableFields), this.defaultSort);
    for (const [apiField, direction] of Object.entries(order)) {
      qb.addOrderBy(`${this.alias}.${this.sortableFields[apiField]}`, direction);
    }
    qb.addOrderBy(`${this.alias}.id`, 'ASC');

    const { skip, take } = toSkipTake(query);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return new PaginatedResult(items, total, query.page, query.per_page);
  }

  /** include=client,... : seules les relations déclarées par le repository sont acceptées. */
  protected applyIncludes(
    qb: SelectQueryBuilder<T>,
    include: string[] | undefined,
    allowed: Readonly<Record<string, string>>,
  ): void {
    if (!include?.length) return;

    const unknown = include.filter((name) => !Object.hasOwn(allowed, name));
    if (unknown.length > 0) {
      throw new ValidationFailedException([
        {
          field: 'include',
          reason: 'includeNotAllowed',
          message: `Relations non disponibles : ${unknown.join(', ')}. Disponibles : ${Object.keys(allowed).join(', ')}.`,
        },
      ]);
    }
    for (const name of new Set(include)) {
      qb.leftJoinAndSelect(`${this.alias}.${allowed[name]}`, `inc_${name}`);
    }
  }

  /** Critères d'une écriture : toujours id + entreprise. */
  protected criteria(companyId: string, id: string, extra: object = {}): FindOptionsWhere<T> {
    return {
      ...extra,
      id,
      companyId: this.requireCompanyId(companyId),
    } as unknown as FindOptionsWhere<T>;
  }

  /** Critères d'une modification (les sous-classes peuvent les restreindre, ex. non archivé). */
  protected writableCriteria(
    companyId: string,
    id: string,
    extra: object = {},
  ): FindOptionsWhere<T> {
    return this.criteria(companyId, id, extra);
  }

  /** Retire les champs que personne ne doit pouvoir modifier par cette voie. */
  protected sanitize(changes: unknown): UpdateChanges<T> {
    const safe: Record<string, unknown> = { ...(changes as Record<string, unknown>) };
    for (const field of PROTECTED_FIELDS) delete safe[field];
    return safe as unknown as UpdateChanges<T>;
  }

  protected requireCompanyId(companyId: string): string {
    if (typeof companyId !== 'string' || companyId.length === 0) {
      throw new Error(
        'companyId obligatoire : un repository multi-tenant ne peut pas être appelé sans entreprise.',
      );
    }
    return companyId;
  }
}