import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SortOrder } from '../dto/index.js';
import { AgencyStructure } from '../entities/agency-structure.entity.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { applyWordSearch } from './search.js';
import { TenantRepository } from './tenant.repository.js';
import type { UpdateChanges } from './tenant.repository.js';

export interface StructureTypeRow {
  id: string;
  name: string;
  slug: string;
}

const MAX_ELEMENTS = 1000;

@Injectable()
export class AgencyStructureRepository extends TenantRepository<AgencyStructure> {
  protected readonly alias = 'astr';
  protected readonly label = "Élément de structure";
  protected readonly sortableFields = { value: 'value', created_at: 'createdAt' };
  protected readonly defaultSort: SortOrder = { created_at: 'ASC' };

  constructor(@InjectRepository(AgencyStructure) repo: Repository<AgencyStructure>) {
    super(repo);
  }

  /** Éléments avec leur type, ordonnés par type puis par ordre de création. */
  list(
    companyId: string,
    filters: { typeId?: string; q?: string },
  ): Promise<AgencyStructure[]> {
    const qb = this.scoped(companyId)
      .leftJoin('astr.type', 'inc_type')
      .addSelect(['inc_type.id', 'inc_type.name', 'inc_type.slug']);
    if (filters.typeId) qb.andWhere('astr.typeId = :fType', { fType: filters.typeId });
    applyWordSearch(qb, `"astr"."value" || ' ' || coalesce("astr"."description", '')`, filters.q);

    return qb
      .orderBy('inc_type.name', 'ASC')
      .addOrderBy('astr.createdAt', 'ASC')
      .addOrderBy('astr.id', 'ASC')
      .limit(MAX_ELEMENTS)
      .getMany();
  }

  /** Tous les types de l'entreprise (y compris ceux sans élément). */
  types(companyId: string, typeId?: string): Promise<StructureTypeRow[]> {
    return this.repo.manager.query(
      `SELECT id, name, slug
         FROM structure_element_types
        WHERE company_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
        ORDER BY name ASC, id ASC`,
      [this.requireCompanyId(companyId), typeId ?? null],
    );
  }

  async getDetailed(companyId: string, id: string): Promise<AgencyStructure> {
    const element = await this.scoped(companyId)
      .leftJoin('astr.type', 'inc_type')
      .addSelect(['inc_type.id', 'inc_type.name', 'inc_type.slug'])
      .andWhere('astr.id = :elId', { elId: id })
      .getOne();
    if (!element) throw new ResourceNotFoundException(this.label);
    return element;
  }

  /** Même valeur (casse ignorée) déjà présente dans ce type ? */
  valueTaken(
    companyId: string,
    typeId: string,
    value: string,
    excludeId?: string,
  ): Promise<boolean> {
    const qb = this.scoped(companyId)
      .andWhere('astr.typeId = :vType', { vType: typeId })
      .andWhere('lower("astr"."value") = lower(CAST(:vValue AS text))', { vValue: value });
    if (excludeId) qb.andWhere('astr.id <> :vExclude', { vExclude: excludeId });
    return qb.getExists();
  }

  insertElement(companyId: string, data: Record<string, unknown>): Promise<AgencyStructure> {
    return this.createOne(companyId, data as never);
  }

  changeElement(
    companyId: string,
    id: string,
    changes: Record<string, unknown>,
  ): Promise<AgencyStructure> {
    return this.updateById(companyId, id, changes as unknown as UpdateChanges<AgencyStructure>);
  }
}