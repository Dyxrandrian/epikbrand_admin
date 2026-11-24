import { Injectable } from '@nestjs/common';
import { BusinessRuleException } from '../../exceptions/index.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import type { ProjectProfitability } from '../../repository/project.repository.js';
import { addMonths } from '../payroll/payroll-calendar.js';
import { monthRange, todayIn } from '../projects/project-dates.js';
import { DASHBOARD_RULES } from './dashboard-rules.js';

export const num = (value: unknown): number => Number(value ?? 0);
export const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Part en % (1 décimale) ; null si le total est nul. */
export const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/** Variation en % par rapport à la période précédente ; null si elle est nulle. */
export const change = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

/**
 * Condition SQL « colonne horodatée comprise entre deux dates locales (incluses) ».
 * Les arguments sont des numéros de paramètres ($2, $3…) ; le fuseau est celui de l'entreprise.
 */
export const inLocalRange = (column: string, from: string, to: string, tz: string): string =>
  `${column} >= (${from}::date)::timestamp AT TIME ZONE ${tz}::text ` +
  `AND ${column} < ((${to}::date + 1))::timestamp AT TIME ZONE ${tz}::text`;

export interface DashboardContext {
  companyId: string;
  timeZone: string;
  currency: string;
  today: string;
}

export interface Period {
  today: string;
  month: string;
  from: string;
  to: string;
  previousMonth: string;
  previousFrom: string;
  previousTo: string;
  months: number;
  windowFromMonth: string;
  windowFrom: string;
  windowTo: string;
}

export function resolvePeriod(
  today: string,
  params: { month?: string; months?: number },
): Period {
  const currentMonth = today.slice(0, 7);
  const month = params.month ?? currentMonth;
  if (month > currentMonth) {
    throw new BusinessRuleException('Le mois demandé ne peut pas être dans le futur.');
  }
  const months = params.months ?? DASHBOARD_RULES.defaultMonths;
  const range = monthRange(`${month}-01`);
  const previousMonth = addMonths(month, -1);
  const previous = monthRange(`${previousMonth}-01`);
  const windowFromMonth = addMonths(month, -(months - 1));

  return {
    today,
    month,
    from: range.from,
    to: range.to,
    previousMonth,
    previousFrom: previous.from,
    previousTo: previous.to,
    months,
    windowFromMonth,
    windowFrom: `${windowFromMonth}-01`,
    windowTo: range.to,
  };
}

export const periodView = (period: Period) => ({
  month: period.month,
  from: period.from,
  to: period.to,
  previous_month: period.previousMonth,
  months: period.months,
  window_from: period.windowFrom,
  today: period.today,
});

export function toProfitability(row: ProjectProfitability) {
  const margin = round2(row.invoicedHt - row.expensesHt);
  return {
    budget_ht: row.budgetHt,
    invoiced_ht: round2(row.invoicedHt),
    invoiced_ttc: round2(row.invoicedTtc),
    collected_ttc: round2(row.collectedTtc),
    expenses_ht: round2(row.expensesHt),
    margin_ht: margin,
    margin_percent: pct(margin, row.invoicedHt),
    budget_consumed_percent:
      row.budgetHt !== null && row.budgetHt > 0 ? pct(row.expensesHt, row.budgetHt) : null,
  };
}

@Injectable()
export class DashboardContextService {
  constructor(private readonly companies: CompanyRepository) {}

  async load(companyId: string): Promise<DashboardContext> {
    const company = await this.companies.getById(companyId);
    return {
      companyId,
      timeZone: company.timezone,
      currency: company.defaultCurrency,
      today: todayIn(company.timezone),
    };
  }
}