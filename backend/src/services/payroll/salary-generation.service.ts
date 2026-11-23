import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { GenerateSalariesDto } from '../../dto/payroll/salary.dto.js';
import { SalaryStatus } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  BusinessRuleException,
  ErrorCode,
  InvalidReferenceException,
} from '../../exceptions/index.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { CompensationRepository } from '../../repository/compensation.repository.js';
import { PayrollRuleRepository } from '../../repository/payroll-rule.repository.js';
import { SalaryRepository } from '../../repository/salary.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { snapshot } from '../audit/audit-changes.js';
import { SALARY_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { todayIn } from '../projects/project-dates.js';
import { MONTH_PATTERN } from './payroll-calendar.js';
import { computePayslip } from './payroll-engine.js';
import type { PayslipComputation } from './payroll-engine.js';
import { toEngineRule, toManualLine, unique } from './salary-helpers.js';

export interface Person {
  user_id: string;
  name: string;
}

@Injectable()
export class SalaryGenerationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly salaries: SalaryRepository,
    private readonly rules: PayrollRuleRepository,
    private readonly employees: CompensationRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Génère les bulletins en attente du mois pour les utilisateurs actifs qui n'en ont pas, sans
   * toucher à l'existant. Relancer la même génération ne crée rien de plus.
   */
  async generate(admin: AuthenticatedUser, dto: GenerateSalariesDto) {
    const { companyId } = admin;
    const today = todayIn((await this.companies.getById(companyId)).timezone);

    if (!MONTH_PATTERN.test(dto.month) || dto.month > today.slice(0, 7)) {
      throw new BusinessRuleException(
        'Le mois doit être au format AAAA-MM et ne peut pas être dans le futur.',
      );
    }
    const wanted = dto.user_ids ? unique(dto.user_ids) : undefined;

    return this.dataSource.transaction(async (manager) => {
      const salaries = this.salaries.withManager(manager);
      await salaries.lockMonth(companyId, dto.month);

      const employees = await this.employees.activeEmployees(companyId, wanted, manager);
      if (wanted && employees.length !== wanted.length) {
        throw new InvalidReferenceException('user_ids', 'Utilisateur');
      }

      const existing = await salaries.existingUserIds(companyId, dto.month);
      const rules = (await this.rules.withManager(manager).effectiveFor(companyId, dto.month)).map(
        toEngineRule,
      );

      const created: Array<Person & { salary_id: string; net_salary: number }> = [];
      const skipped: Array<Person & { reason: string }> = [];
      let alreadyExisting = 0;

      for (const employee of employees) {
        const person: Person = { user_id: employee.id, name: employee.name };

        if (existing.has(employee.id)) {
          alreadyExisting += 1;
          continue;
        }

        // Salaire de base : la fiche, sinon le dernier bulletin non annulé
        const previous = await salaries.previousFor(companyId, employee.id, dto.month);
        const baseSalary = employee.baseSalary ?? previous?.baseSalary ?? null;
        if (baseSalary === null) {
          skipped.push({ ...person, reason: 'no_base_salary' });
          continue;
        }

        const manual =
          dto.carry_manual_lines && previous
            ? (await salaries.manualItems(companyId, previous.id)).map(toManualLine)
            : [];

        let computed: PayslipComputation;
        try {
          computed = computePayslip({
            baseSalary,
            dependents: employee.dependentsCount,
            rules,
            manualLines: manual,
          });
        } catch (error) {
          if (error instanceof BusinessRuleException) {
            skipped.push({
              ...person,
              reason: error.code === ErrorCode.NEGATIVE_NET ? 'negative_net' : 'invalid_amounts',
            });
            continue;
          }
          throw error;
        }

        const inserted = await salaries.insertSalary(companyId, {
          userId: employee.id,
          month: dto.month,
          status: SalaryStatus.PENDING,
          paymentDate: null,
          paymentMethod: null,
          baseSalary: computed.baseSalary,
          dependentsCount: employee.dependentsCount,
          grossSalary: computed.gross,
          totalDeductions: computed.totalDeductions,
          netSalary: computed.net,
          notes: null,
        });
        await salaries.replaceItems(companyId, inserted.id, computed.lines);

        const fresh = await salaries.getById(companyId, inserted.id);
        await this.audit.record(
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.SALARY,
            entityId: fresh.id,
            companyId,
            userId: admin.id,
            changes: {
              after: { ...snapshot(fresh, SALARY_AUDIT_FIELDS), lines_count: computed.lines.length, generated: true },
            },
          },
          manager,
        );
        created.push({ ...person, salary_id: fresh.id, net_salary: computed.net });
      }

      return { month: dto.month, created, skipped, already_existing: alreadyExisting };
    });
  }
}