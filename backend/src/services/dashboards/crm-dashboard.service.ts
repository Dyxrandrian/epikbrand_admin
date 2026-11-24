import { Injectable } from '@nestjs/common';
import type { DashboardQueryDto } from '../../dto/dashboards/dashboard-query.dto.js';
import { CrmDashboardRepository } from '../../repository/dashboards/crm-dashboard.repository.js';
import { addDays } from '../hr/leave-calendar.js';
import { monthsBetween } from '../payroll/payroll-calendar.js';
import { DashboardCacheService } from './dashboard-cache.js';
import { CHARTS } from './dashboard-meta.js';
import { DASHBOARD_RULES } from './dashboard-rules.js';
import { DashboardContextService, change, periodView, resolvePeriod, round2 } from './dashboard-support.js';
import type { DashboardContext, Period } from './dashboard-support.js';
import type { AuthenticatedUser } from '../../security/index.js';

@Injectable()
export class CrmDashboardService {
  constructor(
    private readonly context: DashboardContextService,
    private readonly cache: DashboardCacheService,
    private readonly crm: CrmDashboardRepository,
  ) {}

  async get(viewer: AuthenticatedUser, query: DashboardQueryDto) {
    const ctx = await this.context.load(viewer.companyId);
    const period = resolvePeriod(ctx.today, query);
    const key = this.cache.key('crm', ctx.companyId, 'managers', [period.month, period.months]);
    return this.cache.serve(key, query.refresh === true, () => this.compute(ctx, period));
  }

  private async compute(ctx: DashboardContext, period: Period) {
    const { companyId, currency, timeZone, today } = ctx;
    const rules = DASHBOARD_RULES;
    const followUpBefore = new Date(Date.now() - rules.clientFollowUpDays * 86_400_000);
    const activeSince = addDays(today, -rules.clientDormantDays);

    const [newClients, byType, byUser, interactionSeries, followUp, value, active, dormant] = await Promise.all([
      this.crm.newClientsByMonth(companyId, period.windowFrom, period.windowTo, timeZone),
      this.crm.interactionsByType(companyId, period.from, period.to, timeZone),
      this.crm.interactionsByUser(companyId, period.from, period.to, timeZone),
      this.crm.interactionsByMonth(companyId, period.windowFrom, period.windowTo, timeZone),
      this.crm.clientsToFollowUp(companyId, followUpBefore, 20),
      this.crm.clientValue(companyId, currency, period.windowFrom, period.windowTo, 20),
      this.crm.mostActive(companyId, activeSince, timeZone, 10),
      this.crm.dormant(companyId, activeSince, timeZone, 20),
    ]);

    let cumulative = newClients.totalBefore;
    const months = monthsBetween(period.windowFromMonth, period.month).map((month) => {
      const count = newClients.byMonth.get(month) ?? 0;
      cumulative += count;
      return { month, new_clients: count, total_clients: cumulative };
    });
    const last = months[months.length - 1];
    const before = months[months.length - 2];

    return {
      period: periodView(period),
      currency,
      thresholds: { follow_up_days: rules.clientFollowUpDays, dormant_days: rules.clientDormantDays },

      new_clients: {
        months,
        current_month: last?.new_clients ?? 0,
        change_percent: change(last?.new_clients ?? 0, before?.new_clients ?? 0),
        chart: { type: 'bar', x: 'month', y: ['new_clients'], unit: 'count' },
      },

      interactions: {
        month: period.month,
        total: byType.reduce((s, r) => s + r.n, 0),
        by_type: byType.map((r) => ({ type: r.type, count: r.n })),
        by_user: byUser.map((r) => ({ user_id: r.id, name: r.name ?? 'Auteur supprimé', count: r.n })),
        evolution: monthsBetween(period.windowFromMonth, period.month).map((month) => ({ month, count: interactionSeries.get(month) ?? 0 })),
        chart: CHARTS.statusDonut,
      },

      to_follow_up: {
        total: followUp.total,
        clients: followUp.items.map((c) => ({
          id: c.id, name: c.name, contact: c.contact, email: c.email, phone: c.phone,
          last_interaction_at: c.lastInteractionAt,
        })),
      },

      client_value: {
        clients: value.map((c) => ({
          id: c.id, name: c.name, revenue_ht: round2(c.revenueHt), projects: c.projects, balance_due: round2(c.balanceDue),
        })),
        chart: CHARTS.rankingCurrency,
      },

      most_active: { clients: active },
      dormant: {
        total: dormant.total,
        clients: dormant.items.map((c) => ({ id: c.id, name: c.name, last_activity_at: c.lastActivityAt })),
      },
    };
  }
}