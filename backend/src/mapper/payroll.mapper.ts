import type { PayrollRule } from '../entities/payroll-rule.entity.js';
import type { SalaryItem } from '../entities/salary-item.entity.js';
import type { Salary } from '../entities/salary.entity.js';
import type { EmployeeRow } from '../repository/compensation.repository.js';
import { monthLabel } from '../services/payroll/payroll-calendar.js';

/** `employee` n'apparaît que si la relation a été chargée. */
export function toSalary(salary: Salary, options: { includeNotes: boolean }) {
  return {
    id: salary.id,
    user_id: salary.userId,
    month: salary.month,
    month_label: monthLabel(salary.month),
    status: salary.status,
    payment_date: salary.paymentDate,
    payment_method: salary.paymentMethod,
    base_salary: salary.baseSalary,
    dependents_count: salary.dependentsCount,
    gross_salary: salary.grossSalary,
    total_deductions: salary.totalDeductions,
    net_salary: salary.netSalary,
    ...(options.includeNotes ? { notes: salary.notes } : {}),
    ...(salary.user
      ? {
          employee: {
            id: salary.user.id,
            name: salary.user.name,
            avatar_url: salary.user.avatarUrl,
            job_title: salary.user.jobTitle,
            matricule: salary.user.matricule,
          },
        }
      : {}),
    created_at: salary.createdAt,
    updated_at: salary.updatedAt,
  };
}

export const toSalaryItem = (item: SalaryItem) => ({
  id: item.id,
  position: item.position,
  type: item.type,
  code: item.code,
  label: item.label,
  base_amount: item.baseAmount,
  rate: item.rate,
  amount: item.amount,
  is_manual: item.isManual,
});

export function toSalaryDetail(
  salary: Salary,
  items: SalaryItem[],
  options: { includeNotes: boolean; currency: string },
) {
  return {
    ...toSalary(salary, options),
    currency: options.currency,
    items: items.map(toSalaryItem),
  };
}

export type SalaryDetail = ReturnType<typeof toSalaryDetail>;

export const toPayrollRule = (rule: PayrollRule) => ({
  id: rule.id,
  code: rule.code,
  label: rule.label,
  item_type: rule.itemType,
  rule_type: rule.ruleType,
  base_kind: rule.baseKind,
  rate: rule.rate,
  fixed_amount: rule.fixedAmount,
  base_cap: rule.baseCap,
  rounding_step: rule.roundingStep,
  brackets: rule.brackets,
  family_reduction: rule.familyReduction,
  minimum_amount: rule.minimumAmount,
  reduces_taxable_income: rule.reducesTaxableIncome,
  position: rule.position,
  effective_from: rule.effectiveFrom,
  effective_to: rule.effectiveTo,
  is_active: rule.isActive,
  created_at: rule.createdAt,
  updated_at: rule.updatedAt,
});

export const toCompensation = (employee: EmployeeRow) => ({
  user_id: employee.id,
  name: employee.name,
  avatar_url: employee.avatarUrl,
  job_title: employee.jobTitle,
  matricule: employee.matricule,
  base_salary: employee.baseSalary,
  dependents_count: employee.dependentsCount,
});