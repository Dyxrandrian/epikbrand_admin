import { Injectable } from '@nestjs/common';
import type { DashboardQueryDto } from '../../dto/dashboards/dashboard-query.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { FinanceDashboardRepository } from '../../repository/dashboards/finance-dashboard.repository.js';
import type { DayAmounts } from '../../repository/dashboards/finance-dashboard.repository.js';
import { OperationsDashboardRepository } from '../../repository/dashboards/operations-dashboard.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { AuditService } from '../audit/audit.service.js';
import { eachDay } from '../hr/leave-calendar.js';
import { addMonths, monthsBetween } from '../payroll/payroll-calendar.js';
import { DashboardCacheService } from './dashboard-cache.js';
import { CHARTS, DEFINITIONS } from './dashboard-meta.js';
import { DASHBOARD_RULES } from './dashboard-rules.js';
import {
  DashboardContextService, change, pct, periodView, resolvePeriod, round2,
} from './dashboard-support.js';
import type { DashboardContext, Period } from './dashboard-support.js';

const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const value of values) total += value;
  return round2(total);
};

@Injectable()
export class MonthlyDashboardService {
  constructor(
    private readonly context: DashboardContextService,
    private readonly cache: DashboardCacheService,
    private readonly finance: FinanceDashboardRepository,
    private readonly operations: OperationsDashboardRepository,
    private readonly audit: AuditService,
  ) {}

  async get(viewer: AuthenticatedUser, query: DashboardQueryDto) {
    const ctx = await this.context.load(viewer.companyId);
    const period = resolvePeriod(ctx.today, query);
    const admin = viewer.role === UserRole.ADMIN;

    const key = this.cache.key('monthly', ctx.companyId, admin ? 'admin' : 'manager', [period.month, period.months]);
    const result = await this.cache.serve(key, query.refresh === true, () => this.compute(ctx, period, admin));

    // La trésorerie contient les salaires payés : chaque consultation d'un admin est journalisée
    if (admin) {
      await this.audit.record({
        action: AuditAction.VIEW,
        entityType: AuditEntityType.SALARY,
        companyId: ctx.companyId,
        userId: viewer.id,
        changes: { after: { scope: 'dashboard_monthly', month: period.month } },
      });
    }
    return result;
  }

  private async compute(ctx: DashboardContext, period: Period, includeSalaries: boolean) {
    const { companyId, currency, timeZone } = ctx;
    const limit = DASHBOARD_RULES;
    const yearAgoFrom = `${addMonths(period.windowFromMonth, -12)}-01`;

    const [revenueRows, collected, cash, previousCash, collection, topClients, orders, previousOrders, offers, team] =
      await Promise.all([
        this.finance.revenueByMonth(companyId, currency, yearAgoFrom, period.to),
        this.finance.collectedByMonth(companyId, currency, period.windowFrom, period.to),
        this.finance.cashDaily(companyId, currency, period.from, period.to, includeSalaries),
        this.finance.cashDaily(companyId, currency, period.previousFrom, period.previousTo, includeSalaries),
        this.finance.collection(companyId, currency, period.from, period.to, period.today),
        this.finance.topClients(companyId, currency, period.from, period.to, limit.topClients),
        this.finance.orders(companyId, currency, period.from, period.to, timeZone),
        this.finance.orders(companyId, currency, period.previousFrom, period.previousTo, timeZone),
        this.finance.topOffers(companyId, currency, period.from, period.to, limit.topOffers),
        this.operations.topTeam(companyId, period.from, period.to, timeZone, limit.topTeam),
      ]);
    const methods = await this.finance.inflowsByMethod(companyId, currency, period.from, period.to);

    // ----- CA du mois et évolution -----
    const revenue = new Map(revenueRows.map((row) => [row.month, row]));
    const current = revenue.get(period.month);
    const previous = revenue.get(period.previousMonth);
    const revenueHt = round2(current?.revenueHt ?? 0);

    // ----- Trésorerie -----
    const totals = (flows: typeof cash) => {
      const inflows = sum(flows.inflows.values());
      const expenses = sum(flows.expenses.values());
      const salaries = sum(flows.salaries.values());
      return { inflows, expenses, salaries, net: round2(inflows - expenses - salaries) };
    };
    const cashTotals = totals(cash);
    const previousTotals = totals(previousCash);
    const lastDay = period.today < period.to ? period.today : period.to;
    let balance = 0;
    const daily = eachDay(period.from, lastDay).map((date) => {
      const get = (map: DayAmounts) => map.get(date) ?? 0;
      const inflows = get(cash.inflows);
      const outflows = get(cash.expenses) + get(cash.salaries);
      balance = round2(balance + inflows - outflows);
      return { date, inflows: round2(inflows), outflows: round2(outflows), balance };
    });

    // ----- Commandes -----
    const orderCount = orders.quotes.count + orders.directInvoices.count;
    const orderTotal = round2(orders.quotes.totalHt + orders.directInvoices.totalHt);
    const previousOrderCount = previousOrders.quotes.count + previousOrders.directInvoices.count;

    return {
      period: periodView(period),
      currency,
      definitions: DEFINITIONS,

      revenue: {
        revenue_ht: revenueHt,
        revenue_ttc: round2(current?.revenueTtc ?? 0),
        invoices: current?.invoices ?? 0,
        previous_revenue_ht: round2(previous?.revenueHt ?? 0),
        change_percent: change(revenueHt, previous?.revenueHt ?? 0),
        average_invoice_ht: current?.invoices ? round2(revenueHt / current.invoices) : null,
        chart: CHARTS.kpi,
      },

      revenue_evolution: {
        months: monthsBetween(period.windowFromMonth, period.month).map((month) => ({
          month,
          revenue_ht: round2(revenue.get(month)?.revenueHt ?? 0),
          previous_year_revenue_ht: round2(revenue.get(addMonths(month, -12))?.revenueHt ?? 0),
          collected: round2(collected.get(month) ?? 0),
        })),
        chart: CHARTS.revenueEvolution,
      },

      cash: {
        inflows: cashTotals.inflows,
        expenses_paid: cashTotals.expenses,
        salaries_paid: includeSalaries ? cashTotals.salaries : null,
        includes_salaries: includeSalaries,
        net: cashTotals.net,
        previous_net: previousTotals.net,
        inflows_by_method: methods.map((m) => ({ method: m.method, amount: round2(m.amount), payments: m.payments })),
        daily,
        chart: CHARTS.cashBalance,
      },

      collection: {
        invoices_due: collection.invoices,
        due_ttc: round2(collection.dueTtc),
        settled_ttc: round2(collection.settledTtc),
        remaining_ttc: round2(collection.dueTtc - collection.settledTtc),
        collection_rate_percent: pct(collection.settledTtc, collection.dueTtc),
        overdue_open_ttc: round2(collection.overdueOpenTtc),
        collected_in_month: round2(collected.get(period.month) ?? 0),
        chart: CHARTS.kpi,
      },

      top_clients: {
        clients: topClients.map((client) => ({
          id: client.id,
          name: client.name,
          revenue_ht: round2(client.revenueHt),
          invoices: client.invoices,
          share_percent: pct(client.revenueHt, revenueHt),
        })),
        chart: CHARTS.rankingCurrency,
      },

      orders: {
        count: orderCount,
        total_ht: orderTotal,
        average_order_ht: orderCount > 0 ? round2(orderTotal / orderCount) : null,
        previous_count: previousOrderCount,
        change_percent: change(orderCount, previousOrderCount),
        by_source: {
          accepted_quotes: { count: orders.quotes.count, total_ht: round2(orders.quotes.totalHt) },
          direct_invoices: { count: orders.directInvoices.count, total_ht: round2(orders.directInvoices.totalHt) },
        },
        chart: CHARTS.kpi,
      },

      top_offers: {
        offers: offers.map((offer) => ({
          label: offer.label,
          revenue_ht: round2(offer.revenueHt),
          quantity: offer.quantity,
          documents: offer.documents,
          share_percent: pct(offer.revenueHt, revenueHt),
        })),
        chart: { ...CHARTS.rankingCurrency, x: 'label' },
      },

      top_team: {
        members: team.map((member) => ({
          user: { id: member.id, name: member.name, avatar_url: member.avatarUrl, job_title: member.jobTitle },
          name: member.name,
          completed: member.completed,
          on_time: member.onTime,
          on_time_rate_percent: pct(member.onTime, member.completed),
        })),
        chart: CHARTS.rankingCount,
      },
    };
  }
}