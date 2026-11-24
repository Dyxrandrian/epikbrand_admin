import { Injectable } from '@nestjs/common';
import type { DashboardQueryDto } from '../../dto/dashboards/dashboard-query.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { occurrenceDate } from '../../jobs/recurrence.js';
import { FinanceDashboardRepository } from '../../repository/dashboards/finance-dashboard.repository.js';
import { ProjectRepository } from '../../repository/project.repository.js';
import { SalaryRepository } from '../../repository/salary.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { AuditService } from '../audit/audit.service.js';
import { monthRange } from '../projects/project-dates.js';
import { addMonths, monthsBetween } from '../payroll/payroll-calendar.js';
import { DashboardCacheService } from './dashboard-cache.js';
import { CHARTS, DEFINITIONS } from './dashboard-meta.js';
import { DASHBOARD_RULES } from './dashboard-rules.js';
import {
  DashboardContextService, num, pct, periodView, resolvePeriod, round2, toProfitability,
} from './dashboard-support.js';
import type { DashboardContext, Period } from './dashboard-support.js';

type RiskLevel = 'low' | 'medium' | 'high';

function concentrationRisk(top1: number, top3: number): RiskLevel {
  const c = DASHBOARD_RULES.concentration;
  if (top1 >= c.highTop1 || top3 >= c.highTop3) return 'high';
  if (top1 >= c.mediumTop1 || top3 >= c.mediumTop3) return 'medium';
  return 'low';
}

@Injectable()
export class FinanceDashboardService {
  constructor(
    private readonly context: DashboardContextService,
    private readonly cache: DashboardCacheService,
    private readonly finance: FinanceDashboardRepository,
    private readonly salaries: SalaryRepository,
    private readonly projects: ProjectRepository,
    private readonly audit: AuditService,
  ) {}

  async get(viewer: AuthenticatedUser, query: DashboardQueryDto) {
    const ctx = await this.context.load(viewer.companyId);
    const period = resolvePeriod(ctx.today, query);
    const admin = viewer.role === UserRole.ADMIN;

    const key = this.cache.key('finance', ctx.companyId, admin ? 'admin' : 'manager', [period.month, period.months]);
    const result = await this.cache.serve(key, query.refresh === true, () => this.compute(ctx, period, admin));

    // Masse salariale, résultat et salaires payés : chaque consultation d'un admin est journalisée
    if (admin) {
      await this.audit.record({
        action: AuditAction.VIEW,
        entityType: AuditEntityType.SALARY,
        companyId: ctx.companyId,
        userId: viewer.id,
        changes: { after: { scope: 'dashboard_finance', month: period.month } },
      });
    }
    return result;
  }

  private async compute(ctx: DashboardContext, period: Period, admin: boolean) {
    const { companyId, currency, today } = ctx;
    const top = DASHBOARD_RULES.topClientsYear;

    const [
      revenueRows, expenseMap, payrollRows, byCategory, bySupplier, byProject, receivables,
      receivableClients, clients, quotes, inflows, outflows, templates, profitability, otherCurrency,
    ] = await Promise.all([
      this.finance.revenueByMonth(companyId, currency, period.windowFrom, period.windowTo),
      this.finance.expensesByMonth(companyId, period.windowFrom, period.windowTo),
      admin
        ? this.salaries.payrollByMonth(companyId, period.windowFromMonth, period.month)
        : Promise.resolve([]),
      this.finance.expenseBreakdown(companyId, period.windowFrom, period.windowTo, 'category', 10),
      this.finance.expenseBreakdown(companyId, period.windowFrom, period.windowTo, 'supplier', 10),
      this.finance.expenseBreakdown(companyId, period.windowFrom, period.windowTo, 'project', 10),
      this.finance.receivables(companyId, currency, today),
      this.finance.receivablesByClient(companyId, currency, today, top),
      this.finance.topClients(companyId, currency, period.windowFrom, period.windowTo, top),
      this.finance.quoteConversion(companyId, currency, period.windowFrom, period.windowTo),
      this.finance.forecastInflows(companyId, currency, today),
      this.finance.forecastExpenses(companyId, today),
      this.finance.recurringTemplates(companyId),
      this.projects.profitability(companyId, currency, { includeArchived: false, limit: 20 }),
      this.finance.otherCurrencyDocuments(companyId, currency, period.windowFrom, period.windowTo),
    ]);

    // ----- Revenus contre dépenses -----
    const revenue = new Map(revenueRows.map((row) => [row.month, row.revenueHt]));
    const payroll = new Map(payrollRows.map((row) => [row.month, row]));
    const months = monthsBetween(period.windowFromMonth, period.month).map((month) => {
      const revenueHt = round2(revenue.get(month) ?? 0);
      const expensesHt = round2(expenseMap.get(month)?.ht ?? 0);
      const payrollGross = round2(payroll.get(month)?.gross ?? 0);
      return {
        month,
        revenue_ht: revenueHt,
        expenses_ht: expensesHt,
        ...(admin ? { payroll_gross: payrollGross } : {}),
        result_ht: round2(revenueHt - expensesHt - (admin ? payrollGross : 0)),
      };
    });
    const totalRevenue = round2(months.reduce((s, m) => s + m.revenue_ht, 0));
    const totalExpenses = round2(months.reduce((s, m) => s + m.expenses_ht, 0));
    const totalPayroll = admin ? round2(months.reduce((s, m) => s + (m.payroll_gross ?? 0), 0)) : 0;

    // ----- Répartition des dépenses (top 10 + autres) -----
    const breakdown = (rows: typeof byCategory) => {
      const shown = rows.map((r) => ({ id: r.id, label: r.label, amount_ht: round2(r.amountHt), count: r.count, share_percent: pct(r.amountHt, totalExpenses) }));
      const others = round2(totalExpenses - shown.reduce((s, r) => s + r.amount_ht, 0));
      return others > 0 ? [...shown, { id: 'others', label: 'Autres', amount_ht: others, count: null, share_percent: pct(others, totalExpenses) }] : shown;
    };

    // ----- Concentration du risque client -----
    const share = (n: number) => pct(clients.slice(0, n).reduce((s, c) => s + c.revenueHt, 0), totalRevenue) ?? 0;
    const top1 = share(1), top3 = share(3), top5 = share(5);

    // ----- Conversion des devis -----
    const quoteTotals = quotes.reduce(
      (acc, m) => ({
        sent: acc.sent + m.sent, accepted: acc.accepted + m.accepted, rejected: acc.rejected + m.rejected,
        converted: acc.converted + m.converted, quoted: acc.quoted + m.quotedHt, convertedHt: acc.convertedHt + m.convertedHt,
      }),
      { sent: 0, accepted: 0, rejected: 0, converted: 0, quoted: 0, convertedHt: 0 },
    );

    return {
      period: periodView(period),
      currency,
      definitions: DEFINITIONS,
      includes_payroll: admin,
      excluded: { other_currency_documents: otherCurrency },

      revenue_vs_expenses: {
        months,
        totals: {
          revenue_ht: totalRevenue,
          expenses_ht: totalExpenses,
          ...(admin ? { payroll_gross: totalPayroll } : {}),
          result_ht: round2(totalRevenue - totalExpenses - totalPayroll),
        },
        chart: CHARTS.revenueVsExpenses,
      },

      expense_breakdown: {
        by_category: breakdown(byCategory),
        by_supplier: breakdown(bySupplier),
        by_project: breakdown(byProject),
        chart: CHARTS.breakdown,
      },

      receivables: {
        total: round2(receivables.total),
        invoices: receivables.count,
        aging: receivables.buckets.map((b) => ({ bucket: b.bucket, amount: round2(b.amount), share_percent: pct(b.amount, receivables.total) })),
        by_client: receivableClients.map((c) => ({
          id: c.id, name: c.name, invoices: c.invoices, due: round2(c.due),
          overdue_invoices: c.overdueInvoices, oldest_due_date: c.oldestDueDate,
        })),
        chart: CHARTS.aging,
      },

      revenue_by_client: {
        top: clients.map((c) => ({ id: c.id, name: c.name, revenue_ht: round2(c.revenueHt), invoices: c.invoices, share_percent: pct(c.revenueHt, totalRevenue) })),
        concentration: {
          top1_percent: top1, top3_percent: top3, top5_percent: top5,
          risk_level: totalRevenue > 0 ? concentrationRisk(top1, top3) : null,
        },
        chart: CHARTS.concentration,
      },

      quote_conversion: {
        sent: quoteTotals.sent,
        accepted: quoteTotals.accepted,
        rejected: quoteTotals.rejected,
        converted: quoteTotals.converted,
        acceptance_rate_percent: pct(quoteTotals.accepted, quoteTotals.sent),
        conversion_rate_percent: pct(quoteTotals.converted, quoteTotals.sent),
        quoted_ht: round2(quoteTotals.quoted),
        converted_ht: round2(quoteTotals.convertedHt),
        months: quotes.map((m) => ({ month: m.month, sent: m.sent, accepted: m.accepted, converted: m.converted, conversion_rate_percent: pct(m.converted, m.sent) })),
        chart: CHARTS.funnel,
      },

      cash_forecast: await this.forecast(ctx, admin, inflows, outflows, templates, payroll),

      ...(admin
        ? {
            payroll: {
              months: months.map((m) => {
                const p = payroll.get(m.month);
                const gross = round2(p?.gross ?? 0);
                return {
                  month: m.month, gross, deductions: round2(p?.deductions ?? 0), net: round2(p?.net ?? 0),
                  paid_net: round2(p?.paidNet ?? 0), employees: p?.count ?? 0,
                  share_of_expenses_percent: pct(gross, gross + m.expenses_ht),
                };
              }),
              chart: CHARTS.payroll,
            },
          }
        : {}),

      project_profitability: {
        projects: profitability.map((p) => ({ id: p.id, title: p.title, status: p.status, ...toProfitability(p) })),
        chart: CHARTS.table,
      },
    };
  }

  /**
   * Prévisions des prochains mois : encaissements selon les échéances, dépenses à payer, occurrences
   * récurrentes à venir et (admin) masse salariale estimée sur le dernier mois connu.
   */
  private async forecast(
    ctx: DashboardContext,
    admin: boolean,
    inflows: Awaited<ReturnType<FinanceDashboardRepository['forecastInflows']>>,
    outflows: Awaited<ReturnType<FinanceDashboardRepository['forecastExpenses']>>,
    templates: Awaited<ReturnType<FinanceDashboardRepository['recurringTemplates']>>,
    windowPayroll: Map<string, { net: number }>,
  ) {
    const first = ctx.today.slice(0, 7);
    const horizon = DASHBOARD_RULES.forecastMonths;
    const forecastMonths = monthsBetween(first, addMonths(first, horizon - 1));
    const horizonEnd = monthRange(`${forecastMonths[horizon - 1]}-01`).to;

    // Occurrences récurrentes pas encore générées, dans l'horizon
    const recurring = new Map<string, number>();
    for (const template of templates) {
      for (let k = 1; k <= 2000; k++) {
        const date = occurrenceDate(template.expenseDate, template.recurrence, k);
        if (date > horizonEnd) break;
        if (date <= ctx.today || (template.lastGenerated && date <= template.lastGenerated)) continue;
        recurring.set(date.slice(0, 7), (recurring.get(date.slice(0, 7)) ?? 0) + num(template.amountTtc));
      }
    }

    // Masse salariale estimée : net du dernier mois connu (admin seulement)
    let estimatedPayroll = 0;
    if (admin) {
      const lastKnown = [...windowPayroll.entries()].sort(([a], [b]) => (a < b ? 1 : -1))[0];
      estimatedPayroll = lastKnown ? round2(lastKnown[1].net) : 0;
    }

    let cumulative = 0;
    const months = forecastMonths.map((month, index) => {
      // Ce qui est déjà échu est attendu dès ce mois-ci
      const carried = index === 0 ? inflows.get('overdue')?.amount ?? 0 : 0;
      const expectedInflows = round2((inflows.get(month)?.amount ?? 0) + carried);
      const carriedOut = index === 0 ? outflows.get('overdue')?.amount ?? 0 : 0;
      const expenses = round2((outflows.get(month)?.amount ?? 0) + carriedOut);
      const recurringAmount = round2(recurring.get(month) ?? 0);
      const expectedOutflows = round2(expenses + recurringAmount + estimatedPayroll);
      const net = round2(expectedInflows - expectedOutflows);
      cumulative = round2(cumulative + net);
      return {
        month,
        expected_inflows: expectedInflows,
        expected_outflows: expectedOutflows,
        breakdown: { expenses_due: expenses, recurring_expenses: recurringAmount, ...(admin ? { estimated_payroll: estimatedPayroll } : {}) },
        net,
        cumulative_net: cumulative,
      };
    });

    return {
      months,
      overdue_inflows_carried: round2(inflows.get('overdue')?.amount ?? 0),
      undated: {
        inflows: round2(inflows.get('undated')?.amount ?? 0),
        expenses: round2(outflows.get('undated')?.amount ?? 0),
      },
      includes_payroll: admin,
      chart: CHARTS.forecast,
    };
  }
}