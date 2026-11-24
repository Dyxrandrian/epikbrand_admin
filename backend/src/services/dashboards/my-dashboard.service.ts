import { Injectable } from '@nestjs/common';
import type { DashboardQueryDto } from '../../dto/dashboards/dashboard-query.dto.js';
import { MyDashboardRepository } from '../../repository/dashboards/my-dashboard.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { toBalanceLine } from '../../mapper/hr.mapper.js';
import { eachDay } from '../hr/leave-calendar.js';
import { LeaveBalanceService } from '../hr/leave-balance.service.js';
import { todayIn, weekRange } from '../projects/project-dates.js';
import { DashboardCacheService } from './dashboard-cache.js';
import { CHARTS } from './dashboard-meta.js';
import { DASHBOARD_RULES } from './dashboard-rules.js';
import { DashboardContextService, pct } from './dashboard-support.js';
import type { DashboardContext } from './dashboard-support.js';

const STATUSES = ['todo', 'in_progress', 'review', 'done'];
const count = (list: Array<{ status: string; n: number }>, status: string): number =>
  list.find((r) => r.status === status)?.n ?? 0;

@Injectable()
export class MyDashboardService {
  constructor(
    private readonly context: DashboardContextService,
    private readonly cache: DashboardCacheService,
    private readonly mine: MyDashboardRepository,
    private readonly balances: LeaveBalanceService,
  ) {}

  /** Tout est filtré par l'entreprise et l'utilisateur du jeton : jamais de paramètre d'identité. */
  async get(viewer: AuthenticatedUser, query: DashboardQueryDto) {
    const ctx = await this.context.load(viewer.companyId);
    const key = this.cache.key('me', ctx.companyId, `user:${viewer.id}`, []);
    return this.cache.serve(key, query.refresh === true, () => this.compute(ctx, viewer));
  }

  private async compute(ctx: DashboardContext, viewer: AuthenticatedUser) {
    const { companyId, timeZone, today } = ctx;
    const userId = viewer.id;
    const recent = DASHBOARD_RULES.recentItems;
    const year = Number(today.slice(0, 4));

    const [tasks, leave, notifications, projects, articles, payslips, expenses, balanceLines] = await Promise.all([
      this.mine.tasks(companyId, userId),
      this.mine.leaveRequests(companyId, userId, recent),
      this.mine.notifications(companyId, userId, recent),
      this.mine.projects(companyId, userId, 10),
      this.mine.recentArticles(companyId, userId, recent),
      this.mine.payslips(companyId, userId, 3),
      this.mine.expenses(companyId, userId),
      this.balances.summary(companyId, userId, year),
    ]);

    // ----- Mes tâches par échéance (dates locales de l'entreprise) -----
    const week = weekRange(today);
    const byDue = { overdue: 0, today: 0, this_week: 0, later: 0, no_date: 0 };
    const planned = new Map(eachDay(week.from, week.to).map((date) => [date, 0]));
    for (const task of tasks.open) {
      if (!task.end_date) {
        byDue.no_date += 1;
        continue;
      }
      const due = todayIn(timeZone, task.end_date);
      if (due < today) byDue.overdue += 1;
      else if (due === today) byDue.today += 1;
      else if (due <= week.to) byDue.this_week += 1;
      else byDue.later += 1;
      if (planned.has(due)) planned.set(due, (planned.get(due) ?? 0) + 1);
    }

    const done = count(tasks.byStatus, 'done');
    const total = tasks.byStatus.reduce((s, r) => s + r.n, 0);

    return {
      today,

      tasks: {
        by_status: STATUSES.map((status) => ({ status, count: count(tasks.byStatus, status) })),
        by_due: byDue,
        completion_percent: pct(done, total),
        next: tasks.open.slice(0, 5).map((t) => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority, project: t.project, end_date: t.end_date,
        })),
        chart: CHARTS.statusDonut,
      },

      planned_week: {
        from: week.from,
        to: week.to,
        total: [...planned.values()].reduce((s, n) => s + n, 0),
        days: [...planned.entries()].map(([date, n]) => ({ date, count: n })),
        chart: { type: 'bar', x: 'date', y: ['count'], unit: 'count' },
      },

      leave: {
        by_status: leave.counts.map((r) => ({ status: r.status, count: r.n })),
        recent: leave.recent.map((r) => ({
          id: r.id, leave_type: r.type, start_date: r.start, end_date: r.end, days_count: Number(r.days), status: r.status,
        })),
        balances: balanceLines.filter((line) => line.allowance !== null).map(toBalanceLine),
      },

      notifications: {
        unread_count: notifications.unread,
        recent: notifications.recent.map((n) => ({
          id: n.id, type: n.type, title: n.title, is_read: n.is_read, redirect_url: n.redirect_url, created_at: n.created_at,
        })),
      },

      projects: projects.map((p) => ({
        id: p.id, title: p.title, status: p.status, deadline: p.deadline, my_open_tasks: p.my_open,
        progress: p.total > 0 ? Math.round((p.done * 100) / p.total) : 0,
      })),

      expenses: { pending: expenses.pending, awaiting_validation: expenses.awaiting },

      recent_articles: articles.map((a) => ({ id: a.id, title: a.title, viewed_at: a.viewed_at })),

      // Sans montant : la fiche détaillée (GET /salaries/:id) est, elle, journalisée
      recent_payslips: payslips.map((p) => ({ id: p.id, month: p.month, payment_date: p.payment_date })),
    };
  }
}