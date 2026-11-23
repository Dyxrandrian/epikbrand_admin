import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { PaginatedResult } from '../dto/index.js';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { SalaryItem } from '../entities/salary-item.entity.js';
import { Salary } from '../entities/salary.entity.js';
import type { SalaryStatus } from '../enums/app.enums.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import type { PayslipLine } from '../services/payroll/payroll-engine.js';
import { escapeLike, searchWords } from './search.js';
import { TenantRepository } from './tenant.repository.js';
import type { UpdateChanges } from './tenant.repository.js';

export interface SalaryFilters {
  month?: string;
  monthFrom?: string;
  monthTo?: string;
  userId?: string;
  statuses?: SalaryStatus[];
}

export interface SalaryTotals {
  count: number;
  gross: number;
  deductions: number;
  net: number;
  paid_net: number;
  pending_net: number;
}

export interface MonthlyPayroll {
  month: string;
  count: number;
  gross: number;
  deductions: number;
  net: number;
  paidNet: number;
}

export interface PreviousSalary {
  id: string;
  baseSalary: number;
}

@Injectable()
export class SalaryRepository extends TenantRepository<Salary> {
  protected readonly alias = 'sal';
  protected readonly label = 'Bulletin de salaire';
  protected readonly sortableFields = {
    month: 'month',
    net_salary: 'netSalary',
    gross_salary: 'grossSalary',
    status: 'status',
    created_at: 'createdAt',
  };
  protected readonly defaultSort: SortOrder = { month: 'DESC', created_at: 'DESC' };

  constructor(@InjectRepository(Salary) repo: Repository<Salary>) {
    super(repo);
  }

  // ---------- Lectures ----------

  /** Liste paginée ; `meta.totals` porte exactement sur les bulletins du filtre (annulés exclus). */
  async list(
    companyId: string,
    query: PaginationQueryDto,
    filters: SalaryFilters,
  ): Promise<PaginatedResult<Salary>> {
    const qb = this.filtered(companyId, query, filters);
    this.applyIncludes(qb, query.include, {});
    qb.addSelect(['inc_user.id', 'inc_user.name', 'inc_user.avatarUrl', 'inc_user.jobTitle', 'inc_user.matricule']);

    const page = await this.paginate(qb, query);
    const totals = await this.totals(companyId, query, filters);
    return new PaginatedResult(page.items, page.total, page.page, page.perPage, { totals });
  }

  /** Bulletin avec son employé (id, nom, avatar, poste, matricule seulement). */
  async getDetailed(companyId: string, id: string): Promise<Salary> {
    const salary = await this.scoped(companyId)
      .leftJoin('sal.user', 'inc_user')
      .addSelect(['inc_user.id', 'inc_user.name', 'inc_user.avatarUrl', 'inc_user.jobTitle', 'inc_user.matricule'])
      .andWhere('sal.id = :detailId', { detailId: id })
      .getOne();
    if (!salary) throw new ResourceNotFoundException(this.label);
    return salary;
  }

  /** Verrouille la ligne jusqu'à la fin de la transaction (via withManager()). */
  async lockById(companyId: string, id: string): Promise<Salary> {
    const salary = await this.scoped(companyId)
      .andWhere('sal.id = :lockId', { lockId: id })
      .setLock('pessimistic_write')
      .getOne();
    if (!salary) throw new ResourceNotFoundException(this.label);
    return salary;
  }

  /** Verrou de transaction par entreprise et par mois : une seule génération ou création à la fois. */
  async lockMonth(companyId: string, month: string): Promise<void> {
    await this.repo.manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `salary:${this.requireCompanyId(companyId)}:${month}`,
    ]);
  }

  findByUserMonth(companyId: string, userId: string, month: string): Promise<Salary | null> {
    return this.scoped(companyId)
      .andWhere('sal.userId = :fUser', { fUser: userId })
      .andWhere('sal.month = :fMonth', { fMonth: month })
      .getOne();
  }

  async existingUserIds(companyId: string, month: string): Promise<Set<string>> {
    const rows: Array<{ user_id: string }> = await this.repo.manager.query(
      `SELECT user_id FROM salaries WHERE company_id = $1 AND month = $2`,
      [this.requireCompanyId(companyId), month],
    );
    return new Set(rows.map((row) => row.user_id));
  }

  /** Dernier bulletin non annulé de cette personne avant ce mois. */
  async previousFor(
    companyId: string,
    userId: string,
    month: string,
  ): Promise<PreviousSalary | null> {
    const rows: Array<{ id: string; base: string }> = await this.repo.manager.query(
      `SELECT id, base_salary::text AS base
         FROM salaries
        WHERE company_id = $1 AND user_id = $2 AND month < $3 AND status <> 'cancelled'
        ORDER BY month DESC
        LIMIT 1`,
      [this.requireCompanyId(companyId), userId, month],
    );
    return rows[0] ? { id: rows[0].id, baseSalary: Number(rows[0].base) } : null;
  }

  /** Lignes d'un bulletin de l'entreprise, dans l'ordre. */
  itemsFor(companyId: string, salaryId: string): Promise<SalaryItem[]> {
    return this.repo.manager
      .getRepository(SalaryItem)
      .createQueryBuilder('it')
      .innerJoin('it.salary', 'sal')
      .where('sal.companyId = :itemsCompany', { itemsCompany: this.requireCompanyId(companyId) })
      .andWhere('it.salaryId = :itemsSalary', { itemsSalary: salaryId })
      .orderBy('it.position', 'ASC')
      .getMany();
  }

  /** Lignes saisies à la main : seules reprises lors d'une génération ou d'un recalcul. */
  async manualItems(companyId: string, salaryId: string): Promise<SalaryItem[]> {
    return (await this.itemsFor(companyId, salaryId)).filter((item) => item.isManual);
  }

  /** Masse salariale par mois (bulletins annulés exclus). */
  async payrollByMonth(companyId: string, from: string, to: string): Promise<MonthlyPayroll[]> {
    const rows: Array<Record<string, string | number>> = await this.repo.manager.query(
      `SELECT month,
              COUNT(*)::int AS count,
              SUM(gross_salary)::text AS gross,
              SUM(total_deductions)::text AS deductions,
              SUM(net_salary)::text AS net,
              COALESCE(SUM(net_salary) FILTER (WHERE status = 'paid'), 0)::text AS paid_net
         FROM salaries
        WHERE company_id = $1 AND status <> 'cancelled' AND month >= $2 AND month <= $3
        GROUP BY month
        ORDER BY month ASC`,
      [this.requireCompanyId(companyId), from, to],
    );
    return rows.map((row) => ({
      month: String(row.month),
      count: Number(row.count),
      gross: Number(row.gross),
      deductions: Number(row.deductions),
      net: Number(row.net),
      paidNet: Number(row.paid_net),
    }));
  }

  // ---------- Écritures ----------

  insertSalary(companyId: string, data: Record<string, unknown>): Promise<Salary> {
    return this.createOne(companyId, data as never);
  }

  changeSalary(companyId: string, id: string, changes: Record<string, unknown>): Promise<Salary> {
    return this.updateById(companyId, id, changes as unknown as UpdateChanges<Salary>);
  }

  /** Remplace toutes les lignes du bulletin (suppression puis insertion, dans la transaction). */
  async replaceItems(
    companyId: string,
    salaryId: string,
    lines: readonly PayslipLine[],
  ): Promise<void> {
    const manager = this.repo.manager;
    await manager.query(
      `WITH removed AS (
         DELETE FROM salary_items si
          USING salaries s
          WHERE si.salary_id = s.id AND s.company_id = $1 AND si.salary_id = $2
          RETURNING si.id
       )
       SELECT COUNT(*)::int AS n FROM removed`,
      [this.requireCompanyId(companyId), salaryId],
    );
    if (lines.length > 0) {
      await manager.getRepository(SalaryItem).insert(
        lines.map((line, position) => ({
          salaryId,
          position,
          type: line.type,
          code: line.code,
          label: line.label,
          baseAmount: line.baseAmount,
          rate: line.rate,
          amount: line.amount,
          ruleId: line.ruleId,
          isManual: line.isManual,
        })) as never,
      );
    }
  }

  // ---------- Outils internes ----------

  private filtered(
    companyId: string,
    query: PaginationQueryDto,
    f: SalaryFilters,
  ): SelectQueryBuilder<Salary> {
    const qb = this.scoped(companyId).leftJoin('sal.user', 'inc_user');

    if (f.month) qb.andWhere('sal.month = :fMonth', { fMonth: f.month });
    if (f.monthFrom) qb.andWhere('sal.month >= :fFrom', { fFrom: f.monthFrom });
    if (f.monthTo) qb.andWhere('sal.month <= :fTo', { fTo: f.monthTo });
    if (f.userId) qb.andWhere('sal.userId = :fUser', { fUser: f.userId });
    if (f.statuses?.length) qb.andWhere('sal.status IN (:...fStatuses)', { fStatuses: f.statuses });

    // Recherche : nom de l'employé
    searchWords(query.q).forEach((word, index) => {
      const param = `qword_${index}`;
      qb.andWhere(
        `f_unaccent("inc_user"."name") ILIKE '%' || f_unaccent(CAST(:${param} AS text)) || '%'`,
        { [param]: escapeLike(word) },
      );
    });
    return qb;
  }

  private async totals(
    companyId: string,
    query: PaginationQueryDto,
    filters: SalaryFilters,
  ): Promise<SalaryTotals> {
    const row = await this.filtered(companyId, query, filters)
      .select('CAST(COUNT(*) AS int)', 'count')
      .addSelect(`COALESCE(SUM("sal"."gross_salary") FILTER (WHERE "sal"."status" <> 'cancelled'), 0)`, 'gross')
      .addSelect(`COALESCE(SUM("sal"."total_deductions") FILTER (WHERE "sal"."status" <> 'cancelled'), 0)`, 'deductions')
      .addSelect(`COALESCE(SUM("sal"."net_salary") FILTER (WHERE "sal"."status" <> 'cancelled'), 0)`, 'net')
      .addSelect(`COALESCE(SUM("sal"."net_salary") FILTER (WHERE "sal"."status" = 'paid'), 0)`, 'paid_net')
      .addSelect(`COALESCE(SUM("sal"."net_salary") FILTER (WHERE "sal"."status" = 'pending'), 0)`, 'pending_net')
      .getRawOne<Record<string, string | number>>();

    return {
      count: Number(row?.count ?? 0),
      gross: Number(row?.gross ?? 0),
      deductions: Number(row?.deductions ?? 0),
      net: Number(row?.net ?? 0),
      paid_net: Number(row?.paid_net ?? 0),
      pending_net: Number(row?.pending_net ?? 0),
    };
  }
}