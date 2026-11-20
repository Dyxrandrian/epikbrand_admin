import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { PaginatedResult } from '../dto/index.js';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { ExpenseItem } from '../entities/expense-item.entity.js';
import { Expense } from '../entities/expense.entity.js';
import { ExpenseRecurrence, ExpenseStatus } from '../enums/app.enums.js';
import {
  InvalidReferenceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../exceptions/index.js';
import type { ExpenseItemRow } from '../services/expenses/expense-rules.js';
import { escapeLike, searchWords } from './search.js';
import { TenantRepository } from './tenant.repository.js';
import type { UpdateChanges } from './tenant.repository.js';

export interface ExpenseViewer {
  id: string;
  /** Admin ou manager : voit toutes les dépenses de l'entreprise. */
  privileged: boolean;
}

export interface ExpenseFilters {
  statuses?: ExpenseStatus[];
  categoryId?: string;
  projectId?: string;
  userId?: string;
  supplier?: string;
  dateFrom?: string;
  dateTo?: string;
  dueFrom?: string;
  dueTo?: string;
  overdue?: boolean;
  recurring?: boolean;
  recurrence?: ExpenseRecurrence;
  generatedFrom?: string;
  hasReceipt?: boolean;
  awaitingValidation?: boolean;
  /** Date du jour (AAAA-MM-JJ) dans le fuseau de l'entreprise. */
  today: string;
}

export interface ExpenseTotals {
  count: number;
  total_ht: number;
  total_vat: number;
  total_ttc: number;
  paid_ttc: number;
  pending_ttc: number;
  cancelled_ttc: number;
}

const INCLUDABLE = ['category', 'project', 'user'] as const;
const OVERDUE_SQL = `COALESCE(("expense"."status" = 'pending' AND "expense"."due_date" < :fToday), false)`;
const AWAITING_SQL = `("expense"."status" = 'pending' AND "expense"."validated_at" IS NULL)`;

@Injectable()
export class ExpenseRepository extends TenantRepository<Expense> {
  protected readonly alias = 'expense';
  protected readonly label = 'Dépense';
  protected readonly sortableFields = {
    expense_date: 'expenseDate',
    due_date: 'dueDate',
    amount_ttc: 'amountTtc',
    title: 'title',
    status: 'status',
    created_at: 'createdAt',
  };
  protected readonly defaultSort: SortOrder = { expense_date: 'DESC', created_at: 'DESC' };

  constructor(@InjectRepository(Expense) repo: Repository<Expense>) {
    super(repo);
  }

  // ---------- Lectures ----------

  /** Liste paginée ; `meta.totals` porte exactement sur les dépenses du filtre. */
  async list(
    companyId: string,
    query: PaginationQueryDto,
    viewer: ExpenseViewer,
    filters: ExpenseFilters,
  ): Promise<PaginatedResult<Expense>> {
    const qb = this.filtered(companyId, query, viewer, filters);
    this.applyExpenseIncludes(qb, query.include);

    const page = await this.paginate(qb, query);
    const totals = await this.totals(companyId, query, viewer, filters);
    return new PaginatedResult(page.items, page.total, page.page, page.perPage, { totals });
  }

  /** Dépense visible par ce lecteur (un collaborateur : la sienne), avec catégorie, projet et personne. */
  async getDetailed(companyId: string, id: string, viewer: ExpenseViewer): Promise<Expense> {
    const qb = this.scoped(companyId).andWhere('expense.id = :detailId', { detailId: id });
    this.restrictToOwner(qb, viewer);
    this.applyExpenseIncludes(qb, [...INCLUDABLE]);

    const expense = await qb.getOne();
    if (!expense) throw new ResourceNotFoundException(this.label);
    return expense;
  }

  /** Verrouille la ligne jusqu'à la fin de la transaction (via withManager()). */
  async lockById(companyId: string, id: string, viewer: ExpenseViewer): Promise<Expense> {
    const qb = this.scoped(companyId).andWhere('expense.id = :lockId', { lockId: id });
    this.restrictToOwner(qb, viewer);

    const expense = await qb.setLock('pessimistic_write').getOne();
    if (!expense) throw new ResourceNotFoundException(this.label);
    return expense;
  }

  /** Lignes d'une dépense de l'entreprise, dans l'ordre. */
  itemsFor(companyId: string, expenseId: string): Promise<ExpenseItem[]> {
    return this.repo.manager
      .getRepository(ExpenseItem)
      .createQueryBuilder('it')
      .innerJoin('it.expense', 'exp')
      .where('exp.companyId = :itemsCompany', { itemsCompany: this.requireCompanyId(companyId) })
      .andWhere('it.expenseId = :itemsExpense', { itemsExpense: expenseId })
      .orderBy('it.position', 'ASC')
      .getMany();
  }

  /** Lève un 422 si l'identifiant n'est pas un utilisateur actif de l'entreprise. */
  async assertActiveUser(companyId: string, userId: string, field: string): Promise<void> {
    const rows: Array<{ ok: boolean }> = await this.repo.manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM users WHERE company_id = $1 AND id = $2 AND is_active = true
       ) AS ok`,
      [this.requireCompanyId(companyId), userId],
    );
    if (!rows[0].ok) throw new InvalidReferenceException(field, 'Utilisateur');
  }

  // ---------- Écritures ----------

  insertExpense(companyId: string, data: Record<string, unknown>): Promise<Expense> {
    return this.createOne(companyId, data as never);
  }

  changeExpense(companyId: string, id: string, changes: Record<string, unknown>): Promise<Expense> {
    return this.updateById(companyId, id, changes as unknown as UpdateChanges<Expense>);
  }

  /** Remplace toutes les lignes de la dépense (suppression puis insertion, dans la transaction). */
  async replaceItems(
    companyId: string,
    expenseId: string,
    rows: readonly ExpenseItemRow[],
  ): Promise<void> {
    const manager = this.repo.manager;
    await manager.query(
      `WITH removed AS (
         DELETE FROM expense_items it
          USING expenses e
          WHERE it.expense_id = e.id AND e.company_id = $1 AND it.expense_id = $2
          RETURNING it.id
       )
       SELECT COUNT(*)::int AS n FROM removed`,
      [this.requireCompanyId(companyId), expenseId],
    );
    if (rows.length > 0) {
      await manager
        .getRepository(ExpenseItem)
        .insert(rows.map((row) => ({ ...row, expenseId })) as never);
    }
  }

  // ---------- Outils internes ----------

  private restrictToOwner(qb: SelectQueryBuilder<Expense>, viewer: ExpenseViewer): void {
    if (!viewer.privileged) qb.andWhere('expense.userId = :ownerId', { ownerId: viewer.id });
  }

  private filtered(
    companyId: string,
    query: PaginationQueryDto,
    viewer: ExpenseViewer,
    f: ExpenseFilters,
  ): SelectQueryBuilder<Expense> {
    const qb = this.scoped(companyId);
    this.restrictToOwner(qb, viewer);

    if (f.statuses?.length) qb.andWhere('expense.status IN (:...fStatuses)', { fStatuses: f.statuses });
    if (f.categoryId) qb.andWhere('expense.categoryId = :fCategory', { fCategory: f.categoryId });
    if (f.projectId) qb.andWhere('expense.projectId = :fProject', { fProject: f.projectId });
    if (f.userId) qb.andWhere('expense.userId = :fUser', { fUser: f.userId });
    if (f.dateFrom) qb.andWhere('expense.expenseDate >= :fDateFrom', { fDateFrom: f.dateFrom });
    if (f.dateTo) qb.andWhere('expense.expenseDate <= :fDateTo', { fDateTo: f.dateTo });
    if (f.dueFrom) qb.andWhere('expense.dueDate >= :fDueFrom', { fDueFrom: f.dueFrom });
    if (f.dueTo) qb.andWhere('expense.dueDate <= :fDueTo', { fDueTo: f.dueTo });
    if (f.recurrence) qb.andWhere('expense.recurrence = :fRecurrence', { fRecurrence: f.recurrence });
    if (f.generatedFrom) {
      qb.andWhere('expense.parentExpenseId = :fParent', { fParent: f.generatedFrom });
    }
    if (f.recurring !== undefined) {
      qb.andWhere('expense.isRecurring = :fRecurring', { fRecurring: f.recurring });
    }
    if (f.hasReceipt !== undefined) {
      qb.andWhere(f.hasReceipt ? 'expense.receiptUrl IS NOT NULL' : 'expense.receiptUrl IS NULL');
    }
    if (f.awaitingValidation !== undefined) {
      qb.andWhere(f.awaitingValidation ? AWAITING_SQL : `NOT ${AWAITING_SQL}`);
    }
    if (f.overdue !== undefined) {
      qb.andWhere(f.overdue ? OVERDUE_SQL : `NOT ${OVERDUE_SQL}`, { fToday: f.today });
    }

    if (f.supplier) {
      qb.andWhere(
        `f_unaccent("expense"."supplier_name") ILIKE '%' || f_unaccent(CAST(:fSupplier AS text)) || '%'`,
        { fSupplier: escapeLike(f.supplier) },
      );
    }

    // Chaque mot doit apparaître dans le titre ou dans le nom du fournisseur
    searchWords(query.q).forEach((word, index) => {
      const param = `qword_${index}`;
      qb.andWhere(
        `(f_unaccent("expense"."title") ILIKE '%' || f_unaccent(CAST(:${param} AS text)) || '%'
          OR f_unaccent("expense"."supplier_name") ILIKE '%' || f_unaccent(CAST(:${param} AS text)) || '%')`,
        { [param]: escapeLike(word) },
      );
    });
    return qb;
  }

  private async totals(
    companyId: string,
    query: PaginationQueryDto,
    viewer: ExpenseViewer,
    filters: ExpenseFilters,
  ): Promise<ExpenseTotals> {
    const row = await this.filtered(companyId, query, viewer, filters)
      .select('CAST(COUNT(*) AS int)', 'count')
      // Les montants globaux excluent les dépenses annulées
      .addSelect(
        `COALESCE(SUM("expense"."amount_ht") FILTER (WHERE "expense"."status" <> 'cancelled'), 0)`,
        'total_ht',
      )
      .addSelect(
        `COALESCE(SUM("expense"."vat_amount") FILTER (WHERE "expense"."status" <> 'cancelled'), 0)`,
        'total_vat',
      )
      .addSelect(
        `COALESCE(SUM("expense"."amount_ttc") FILTER (WHERE "expense"."status" <> 'cancelled'), 0)`,
        'total_ttc',
      )
      .addSelect(
        `COALESCE(SUM("expense"."amount_ttc") FILTER (WHERE "expense"."status" = 'paid'), 0)`,
        'paid_ttc',
      )
      .addSelect(
        `COALESCE(SUM("expense"."amount_ttc") FILTER (WHERE "expense"."status" = 'pending'), 0)`,
        'pending_ttc',
      )
      .addSelect(
        `COALESCE(SUM("expense"."amount_ttc") FILTER (WHERE "expense"."status" = 'cancelled'), 0)`,
        'cancelled_ttc',
      )
      .getRawOne<Record<string, string | number>>();

    return {
      count: Number(row?.count ?? 0),
      total_ht: Number(row?.total_ht ?? 0),
      total_vat: Number(row?.total_vat ?? 0),
      total_ttc: Number(row?.total_ttc ?? 0),
      paid_ttc: Number(row?.paid_ttc ?? 0),
      pending_ttc: Number(row?.pending_ttc ?? 0),
      cancelled_ttc: Number(row?.cancelled_ttc ?? 0),
    };
  }

  /** include=category,project,user : id et nom seulement (jamais le reste de la fiche). */
  private applyExpenseIncludes(
    qb: SelectQueryBuilder<Expense>,
    include: readonly string[] | undefined,
  ): void {
    if (!include?.length) return;

    const unknown = include.filter((name) => !(INCLUDABLE as readonly string[]).includes(name));
    if (unknown.length > 0) {
      throw new ValidationFailedException([
        {
          field: 'include',
          reason: 'includeNotAllowed',
          message: `Relations non disponibles : ${unknown.join(', ')}. Disponibles : ${INCLUDABLE.join(', ')}.`,
        },
      ]);
    }

    const wanted = new Set(include);
    if (wanted.has('category')) {
      qb.leftJoin('expense.category', 'inc_category').addSelect([
        'inc_category.id',
        'inc_category.name',
      ]);
    }
    if (wanted.has('project')) {
      qb.leftJoin('expense.project', 'inc_project').addSelect([
        'inc_project.id',
        'inc_project.title',
      ]);
    }
    if (wanted.has('user')) {
      qb.leftJoin('expense.user', 'inc_user').addSelect([
        'inc_user.id',
        'inc_user.name',
        'inc_user.avatarUrl',
      ]);
    }
  }
}