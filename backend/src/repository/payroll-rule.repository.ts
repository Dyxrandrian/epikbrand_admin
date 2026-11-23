import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { PayrollRule } from '../entities/payroll-rule.entity.js';
import type { SalaryItemType } from '../enums/app.enums.js';
import { monthStart } from '../services/payroll/payroll-calendar.js';
import { TenantRepository } from './tenant.repository.js';
import type { UpdateChanges } from './tenant.repository.js';

@Injectable()
export class PayrollRuleRepository extends TenantRepository<PayrollRule> {
  protected readonly alias = 'prule';
  protected readonly label = 'Règle de paie';
  protected readonly sortableFields = {
    position: 'position',
    code: 'code',
    effective_from: 'effectiveFrom',
  };
  protected readonly defaultSort: SortOrder = { position: 'ASC', effective_from: 'DESC' };

  constructor(@InjectRepository(PayrollRule) repo: Repository<PayrollRule>) {
    super(repo);
  }

  list(
    companyId: string,
    query: PaginationQueryDto,
    filters: { isActive?: boolean; itemType?: SalaryItemType },
  ) {
    const qb = this.scoped(companyId);
    this.applyIncludes(qb, query.include, {});
    if (filters.isActive !== undefined) {
      qb.andWhere('prule.isActive = :fActive', { fActive: filters.isActive });
    }
    if (filters.itemType) qb.andWhere('prule.itemType = :fItemType', { fItemType: filters.itemType });
    return this.paginate(qb, query);
  }

  /** Règles actives en vigueur le premier jour de ce mois (AAAA-MM). */
  effectiveFor(companyId: string, month: string): Promise<PayrollRule[]> {
    const day = monthStart(month);
    return this.scoped(companyId)
      .andWhere('prule.isActive = true')
      .andWhere('prule.effectiveFrom <= :effDay', { effDay: day })
      .andWhere('(prule.effectiveTo IS NULL OR prule.effectiveTo >= :effDay)')
      .orderBy('prule.position', 'ASC')
      .addOrderBy('prule.code', 'ASC')
      .getMany();
  }

  /** Règle active de même code dont la période chevauche [from, to]. */
  findOverlapping(
    companyId: string,
    code: string,
    from: string,
    to: string | null,
    excludeId: string | null,
  ): Promise<PayrollRule | null> {
    const qb = this.scoped(companyId)
      .andWhere('prule.code = :ovCode', { ovCode: code })
      .andWhere('prule.isActive = true')
      .andWhere('prule.effectiveFrom <= :ovTo', { ovTo: to ?? '9999-12-31' })
      .andWhere('(prule.effectiveTo IS NULL OR prule.effectiveTo >= :ovFrom)', { ovFrom: from });
    if (excludeId) qb.andWhere('prule.id <> :ovExclude', { ovExclude: excludeId });
    return qb.getOne();
  }

  /** Version existante de ce code commençant le même jour (installation d'un modèle idempotente). */
  findVersion(companyId: string, code: string, effectiveFrom: string): Promise<PayrollRule | null> {
    return this.scoped(companyId)
      .andWhere('prule.code = :vCode', { vCode: code })
      .andWhere('prule.effectiveFrom = :vFrom', { vFrom: effectiveFrom })
      .getOne();
  }

  insertRule(companyId: string, data: Record<string, unknown>): Promise<PayrollRule> {
    return this.createOne(companyId, data as never);
  }

  changeRule(companyId: string, id: string, changes: Record<string, unknown>): Promise<PayrollRule> {
    return this.updateById(companyId, id, changes as unknown as UpdateChanges<PayrollRule>);
  }
}