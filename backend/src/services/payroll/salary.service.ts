import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaginatedResult } from '../../dto/index.js';
import type { PageQueryDto } from '../../dto/index.js';
import type {
  CreateSalaryDto,
  PaySalaryDto,
  PayrollSummaryQueryDto,
  SalaryLineDto,
  SalaryListQueryDto,
  UpdateSalaryDto,
} from '../../dto/payroll/salary.dto.js';
import type { Salary } from '../../entities/salary.entity.js';
import { SalaryStatus, UserRole } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
  InvalidReferenceException,
  ResourceNotFoundException,
} from '../../exceptions/index.js';
import { toSalary, toSalaryDetail } from '../../mapper/payroll.mapper.js';
import type { SalaryDetail } from '../../mapper/payroll.mapper.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { CompensationRepository } from '../../repository/compensation.repository.js';
import { PayrollRuleRepository } from '../../repository/payroll-rule.repository.js';
import { SalaryRepository } from '../../repository/salary.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { SALARY_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { todayIn } from '../projects/project-dates.js';
import { MONTH_PATTERN, addMonths, monthsBetween } from './payroll-calendar.js';
import { computePayslip } from './payroll-engine.js';
import type { ManualLine } from './payroll-engine.js';
import { toEngineRule, toManualLine } from './salary-helpers.js';

const { PENDING, PAID, CANCELLED } = SalaryStatus;

const toManual = (line: SalaryLineDto): ManualLine => ({
  type: line.type,
  code: line.code,
  label: line.label,
  baseAmount: line.base_amount ?? null,
  rate: line.rate ?? null,
  amount: line.amount,
});

@Injectable()
export class SalaryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly salaries: SalaryRepository,
    private readonly rules: PayrollRuleRepository,
    private readonly employees: CompensationRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditService,
  ) {}

  // ---------- Lectures (toutes journalisées avant de renvoyer les données) ----------

  async list(admin: AuthenticatedUser, query: SalaryListQueryDto) {
    const company = await this.companies.getById(admin.companyId);
    const result = await this.salaries.list(admin.companyId, query, {
      month: query.month,
      monthFrom: query.from,
      monthTo: query.to,
      userId: query.user_id,
      statuses: query.status,
    });

    await this.auditView(admin, null, {
      scope: 'list',
      month: query.month ?? null,
      user_id: query.user_id ?? null,
      result_count: result.items.length,
    });

    return new PaginatedResult(
      result.items.map((salary) => toSalary(salary, { includeNotes: true })),
      result.total,
      result.page,
      result.perPage,
      { totals: { currency: company.defaultCurrency, ...(result.extra.totals as object) } },
    );
  }

  /** Mes bulletins : payés seulement (un bulletin en attente peut encore changer). */
  async mine(viewer: AuthenticatedUser, query: PageQueryDto) {
    const result = await this.salaries.list(viewer.companyId, query, {
      userId: viewer.id,
      statuses: [PAID],
    });
    await this.auditView(viewer, null, { scope: 'mine', result_count: result.items.length });
    return result.map((salary) => toSalary(salary, { includeNotes: false }));
  }

  async get(viewer: AuthenticatedUser, id: string) {
    const salary = await this.loadReadable(viewer, id);
    await this.auditView(viewer, id, { month: salary.month, owner_id: salary.userId });
    return this.present(viewer, salary);
  }

  /** Pour le PDF : mêmes droits, consultation journalisée avec son format. */
  async readForPdf(viewer: AuthenticatedUser, id: string): Promise<SalaryDetail> {
    const salary = await this.loadReadable(viewer, id);
    await this.auditView(viewer, id, { month: salary.month, owner_id: salary.userId, format: 'pdf' });
    return this.present(viewer, salary);
  }

  /** Masse salariale par mois, avec évolution par rapport au mois précédent (bulletins annulés exclus). */
  async summary(admin: AuthenticatedUser, query: PayrollSummaryQueryDto) {
    const { company, today } = await this.context(admin.companyId);
    const to = query.to ?? today.slice(0, 7);
    const from = addMonths(to, -((query.months ?? 12) - 1));

    // Un mois de plus avant la fenêtre, pour comparer son premier mois
    const rows = await this.salaries.payrollByMonth(admin.companyId, addMonths(from, -1), to);
    const byMonth = new Map(rows.map((row) => [row.month, row]));

    const months = monthsBetween(from, to).map((month) => {
      const row = byMonth.get(month);
      const previous = byMonth.get(addMonths(month, -1));
      const net = row?.net ?? 0;
      return {
        month,
        count: row?.count ?? 0,
        gross: row?.gross ?? 0,
        deductions: row?.deductions ?? 0,
        net,
        paid_net: row?.paidNet ?? 0,
        pending_net: Math.round(((row?.net ?? 0) - (row?.paidNet ?? 0)) * 100) / 100,
        net_change_percent:
          previous && previous.net > 0
            ? Math.round(((net - previous.net) / previous.net) * 1000) / 10
            : null,
      };
    });

    await this.auditView(admin, null, { scope: 'summary', from, to });
    return { currency: company.defaultCurrency, from, to, months };
  }

  // ---------- Écritures ----------

  async create(admin: AuthenticatedUser, dto: CreateSalaryDto) {
    const { companyId } = admin;
    const { today } = await this.context(companyId);
    this.assertMonthAllowed(dto.month, today);

    const employee = await this.employees.findActive(companyId, dto.user_id);
    if (!employee) throw new InvalidReferenceException('user_id', 'Utilisateur');
    const manual = (dto.items ?? []).map(toManual);

    const id = await this.dataSource.transaction(async (manager) => {
      const repo = this.salaries.withManager(manager);
      await repo.lockMonth(companyId, dto.month);

      if (await repo.findByUserMonth(companyId, dto.user_id, dto.month)) {
        throw new ConflictAppException(
          'Un bulletin existe déjà pour cette personne et ce mois. Supprimez-le (s\'il n\'est pas payé) pour le recréer.',
          ErrorCode.DUPLICATE_RESOURCE,
        );
      }

      const baseSalary = dto.base_salary ?? employee.baseSalary;
      if (baseSalary === null) {
        throw new BusinessRuleException(
          "Cette personne n'a pas de salaire de base : renseignez-le dans sa fiche de rémunération, ou indiquez base_salary.",
          ErrorCode.NO_BASE_SALARY,
        );
      }
      const dependents = dto.dependents_count ?? employee.dependentsCount;

      const rules = (await this.rules.withManager(manager).effectiveFor(companyId, dto.month)).map(
        toEngineRule,
      );
      const computed = computePayslip({ baseSalary, dependents, rules, manualLines: manual });

      const created = await repo.insertSalary(companyId, {
        userId: dto.user_id,
        month: dto.month,
        status: PENDING,
        paymentDate: null,
        paymentMethod: null,
        baseSalary: computed.baseSalary,
        dependentsCount: dependents,
        grossSalary: computed.gross,
        totalDeductions: computed.totalDeductions,
        netSalary: computed.net,
        notes: dto.notes ?? null,
      });
      await repo.replaceItems(companyId, created.id, computed.lines);

      const fresh = await repo.getById(companyId, created.id);
      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.SALARY,
          entityId: fresh.id,
          companyId,
          userId: admin.id,
          changes: { after: { ...snapshot(fresh, SALARY_AUDIT_FIELDS), lines_count: computed.lines.length } },
        },
        manager,
      );
      return fresh.id;
    });

    return this.present(admin, await this.salaries.getDetailed(companyId, id));
  }

  /**
   * Bulletin en attente seulement. Tout changement de montant recalcule toutes les lignes avec
   * les règles en vigueur ce mois-là ; les lignes manuelles sont conservées sauf si `items` les remplace.
   */
  async update(admin: AuthenticatedUser, id: string, dto: UpdateSalaryDto) {
    const { companyId } = admin;

    await this.dataSource.transaction(async (manager) => {
      const repo = this.salaries.withManager(manager);
      const before = await repo.lockById(companyId, id);
      this.assertPending(before);

      const changes: Record<string, unknown> = {};
      if (dto.notes !== undefined) changes.notes = dto.notes;

      let linesCount: number | null = null;
      const recompute =
        dto.base_salary !== undefined ||
        dto.dependents_count !== undefined ||
        dto.items !== undefined;

      if (recompute) {
        const dependents = dto.dependents_count ?? before.dependentsCount;
        const manual = dto.items
          ? dto.items.map(toManual)
          : (await repo.manualItems(companyId, id)).map(toManualLine);
        const rules = (
          await this.rules.withManager(manager).effectiveFor(companyId, before.month)
        ).map(toEngineRule);

        const computed = computePayslip({
          baseSalary: dto.base_salary ?? before.baseSalary,
          dependents,
          rules,
          manualLines: manual,
        });
        Object.assign(changes, {
          baseSalary: computed.baseSalary,
          dependentsCount: dependents,
          grossSalary: computed.gross,
          totalDeductions: computed.totalDeductions,
          netSalary: computed.net,
        });
        await repo.replaceItems(companyId, id, computed.lines);
        linesCount = computed.lines.length;
      }

      if (Object.keys(changes).length === 0) return;

      const after = await repo.changeSalary(companyId, id, changes);
      const diff = diffChanges(before, after, SALARY_AUDIT_FIELDS);
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.SALARY,
          entityId: id,
          companyId,
          userId: admin.id,
          changes: {
            before: diff?.before ?? {},
            after: { ...(diff?.after ?? {}), ...(linesCount !== null ? { lines_recomputed: linesCount } : {}) },
          },
        },
        manager,
      );
    });

    return this.present(admin, await this.salaries.getDetailed(companyId, id));
  }

  /** Marque payé : date et moyen enregistrés. Un bulletin payé est définitif. */
  async pay(admin: AuthenticatedUser, id: string, dto: PaySalaryDto) {
    const { companyId } = admin;
    const { today } = await this.context(companyId);

    const paymentDate = dto.payment_date ?? today;
    if (paymentDate > today) {
      throw new BusinessRuleException('La date du paiement ne peut pas être dans le futur.');
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = this.salaries.withManager(manager);
      const before = await repo.lockById(companyId, id);

      if (before.status === PAID) {
        throw new ConflictAppException('Ce bulletin est déjà payé.', ErrorCode.INVALID_STATE);
      }
      if (before.status === CANCELLED) {
        throw new ConflictAppException('Ce bulletin est annulé.', ErrorCode.INVALID_STATE);
      }

      const after = await repo.changeSalary(companyId, id, {
        status: PAID,
        paymentDate,
        paymentMethod: dto.method,
      });
      await this.audit.record(
        {
          action: AuditAction.PAY,
          entityType: AuditEntityType.SALARY,
          entityId: id,
          companyId,
          userId: admin.id,
          changes: diffChanges(before, after, SALARY_AUDIT_FIELDS),
        },
        manager,
      );
    });

    return this.present(admin, await this.salaries.getDetailed(companyId, id));
  }

  /** Annule un bulletin en attente. Idempotent. Un bulletin payé ne s'annule pas. */
  async cancel(admin: AuthenticatedUser, id: string) {
    const { companyId } = admin;

    await this.dataSource.transaction(async (manager) => {
      const repo = this.salaries.withManager(manager);
      const before = await repo.lockById(companyId, id);

      if (before.status === CANCELLED) return;
      if (before.status === PAID) {
        throw new ConflictAppException(
          'Un bulletin payé est définitif : il ne peut pas être annulé.',
          ErrorCode.INVALID_STATE,
        );
      }

      const after = await repo.changeSalary(companyId, id, { status: CANCELLED });
      await this.audit.record(
        {
          action: AuditAction.CANCEL,
          entityType: AuditEntityType.SALARY,
          entityId: id,
          companyId,
          userId: admin.id,
          changes: diffChanges(before, after, SALARY_AUDIT_FIELDS),
        },
        manager,
      );
    });

    return this.present(admin, await this.salaries.getDetailed(companyId, id));
  }

  /** Suppression d'un bulletin non payé (pour pouvoir le recréer). */
  async remove(admin: AuthenticatedUser, id: string): Promise<void> {
    const { companyId } = admin;

    await this.dataSource.transaction(async (manager) => {
      const repo = this.salaries.withManager(manager);
      const salary = await repo.lockById(companyId, id);
      if (salary.status === PAID) {
        throw new ConflictAppException(
          'Un bulletin payé est définitif : il ne peut pas être supprimé.',
          ErrorCode.INVALID_STATE,
        );
      }

      const before = snapshot(salary, SALARY_AUDIT_FIELDS);
      await repo.deleteById(companyId, id); // les lignes partent en cascade

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entityType: AuditEntityType.SALARY,
          entityId: id,
          companyId,
          userId: admin.id,
          changes: { before },
        },
        manager,
      );
    });
  }

  // ---------- Outils internes ----------

  /** Admin : tout. Les autres : leurs propres bulletins payés ; 404 sinon (l'existence n'est pas révélée). */
  private async loadReadable(viewer: AuthenticatedUser, id: string): Promise<Salary> {
    const salary = await this.salaries.getDetailed(viewer.companyId, id);
    const own = salary.userId === viewer.id && salary.status === PAID;
    if (viewer.role !== UserRole.ADMIN && !own) {
      throw new ResourceNotFoundException('Bulletin de salaire');
    }
    return salary;
  }

  private async present(viewer: AuthenticatedUser, salary: Salary): Promise<SalaryDetail> {
    const [company, items] = await Promise.all([
      this.companies.getById(viewer.companyId),
      this.salaries.itemsFor(viewer.companyId, salary.id),
    ]);
    return toSalaryDetail(salary, items, {
      includeNotes: viewer.role === UserRole.ADMIN,
      currency: company.defaultCurrency,
    });
  }

  /** Écrit la consultation dans l'audit : si le journal échoue, la consultation échoue. */
  private auditView(
    viewer: AuthenticatedUser,
    entityId: string | null,
    info: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      action: AuditAction.VIEW,
      entityType: AuditEntityType.SALARY,
      entityId,
      companyId: viewer.companyId,
      userId: viewer.id,
      changes: { after: info },
    });
  }

  private async context(companyId: string) {
    const company = await this.companies.getById(companyId);
    return { company, today: todayIn(company.timezone) };
  }

  private assertMonthAllowed(month: string, today: string): void {
    if (!MONTH_PATTERN.test(month)) {
      throw new BusinessRuleException('Le mois doit être au format AAAA-MM.');
    }
    if (month > today.slice(0, 7)) {
      throw new BusinessRuleException('Un bulletin ne peut pas être établi pour un mois futur.');
    }
  }

  private assertPending(salary: Salary): void {
    if (salary.status !== PENDING) {
      throw new BusinessRuleException(
        salary.status === PAID
          ? "Un bulletin payé n'est plus modifiable."
          : "Un bulletin annulé n'est plus modifiable.",
        ErrorCode.SALARY_LOCKED,
      );
    }
  }
}