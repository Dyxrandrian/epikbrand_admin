import { Injectable } from '@nestjs/common';
import type { DashboardQueryDto } from '../../dto/dashboards/dashboard-query.dto.js';
import { FinanceDashboardRepository } from '../../repository/dashboards/finance-dashboard.repository.js';
import { OperationsDashboardRepository } from '../../repository/dashboards/operations-dashboard.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { addDays, dayOrdinal } from '../hr/leave-calendar.js';
import { monthsBetween } from '../payroll/payroll-calendar.js';
import { weekRange } from '../projects/project-dates.js';
import { DashboardCacheService } from './dashboard-cache.js';
import { CHARTS } from './dashboard-meta.js';
import { DASHBOARD_RULES } from './dashboard-rules.js';
import {
  DashboardContextService, change, pct, periodView, resolvePeriod, round2,
} from './dashboard-support.js';
import type { DashboardContext } from './dashboard-support.js';

const TASK_ORDER = ['todo', 'in_progress', 'review', 'done'];
const PROJECT_ORDER = ['pending', 'ongoing'];
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const person = (r: { id: string; name: string; avatarUrl: string | null; jobTitle: string | null }) => ({
  id: r.id, name: r.name, avatar_url: r.avatarUrl, job_title: r.jobTitle,
});

@Injectable()
export class OperationsDashboardService {
  constructor(
    private readonly context: DashboardContextService,
    private readonly cache: DashboardCacheService,
    private readonly operations: OperationsDashboardRepository,
    private readonly finance: FinanceDashboardRepository,
  ) {}

  // ---------- Général (13.1) ----------

  async general(viewer: AuthenticatedUser, query: DashboardQueryDto) {
    const ctx = await this.context.load(viewer.companyId);
    const period = resolvePeriod(ctx.today, { month: query.month, months: 2 });

    const key = this.cache.key('general', ctx.companyId, 'managers', [period.month]);
    const shared = await this.cache.serve(key, query.refresh === true, () => this.computeGeneral(ctx, period));

    // « À faire pour moi » est personnel : il n'est jamais mis en cache avec le reste
    const todo = await this.operations.todo(ctx.companyId, viewer.id, ctx.today, ctx.timeZone);
    return {
      ...shared,
      todo: {
        tasks: todo.tasks.map((t) => ({
          id: t.id, title: t.title, status: t.status, project: t.project, end_date: t.end_date,
          is_overdue: t.end_date < new Date(),
        })),
        awaiting_my_validation: { leave_requests: todo.leave, training_requests: todo.training, expenses: todo.expenses },
        unread_notifications: todo.unread,
      },
    };
  }

  private async computeGeneral(ctx: DashboardContext, period: ReturnType<typeof resolvePeriod>) {
    const { companyId, currency, timeZone, today } = ctx;
    const n = DASHBOARD_RULES.recentItems;
    const l = DASHBOARD_RULES.listLimit;

    const [counts, revenueRows, collected, clients, tasks, invoices, interactions, lateInvoices, dueProjects, lateTasks, lateExpenses] =
      await Promise.all([
        this.operations.generalCounts(companyId, currency, today, period.from, period.to, timeZone),
        this.finance.revenueByMonth(companyId, currency, period.previousFrom, period.to),
        this.finance.collectedByMonth(companyId, currency, period.from, period.to),
        this.operations.recentClients(companyId, n),
        this.operations.recentTasks(companyId, n),
        this.operations.recentInvoices(companyId, n),
        this.operations.recentInteractions(companyId, n),
        this.operations.overdueInvoices(companyId, currency, today, l),
        this.operations.projectsDueSoon(companyId, today, 7, l),
        this.operations.overdueTasks(companyId, l),
        this.operations.overdueExpenses(companyId, today, l),
      ]);

    const revenue = new Map(revenueRows.map((r) => [r.month, r.revenueHt]));
    const current = revenue.get(period.month) ?? 0;

    return {
      period: periodView(period),
      currency,
      kpis: {
        revenue_ht: round2(current),
        revenue_change_percent: change(current, revenue.get(period.previousMonth) ?? 0),
        collected: round2(collected.get(period.month) ?? 0),
        unpaid_invoices: { count: counts.unpaidCount, total: round2(counts.unpaidTotal) },
        overdue_invoices: { count: counts.overdueCount, total: round2(counts.overdueTotal) },
        ongoing_projects: counts.ongoingProjects,
        open_tasks: counts.openTasks,
        overdue_tasks: counts.overdueTasks,
        active_clients: counts.activeClients,
        new_clients: counts.newClients,
        pending_requests: { leave: counts.pendingLeave, training: counts.pendingTraining, expenses: counts.pendingExpenses },
        chart: CHARTS.kpi,
      },
      recent_activity: {
        clients: clients.map((c) => ({ id: c.id, name: c.name, created_at: c.created_at })),
        tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, project: t.project, created_at: t.created_at })),
        invoices: invoices.map((i) => ({
          id: i.id, invoice_number: i.number, type: i.type, status: i.status,
          total_ttc: Number(i.total_ttc), currency: i.currency, client: i.client, created_at: i.created_at,
        })),
        interactions: interactions.map((x) => ({
          id: x.id, type: x.type, summary: clip(x.summary, 140), date: x.date,
          client: { id: x.client_id, name: x.client }, author: x.author,
        })),
      },
      alerts: {
        overdue_invoices: {
          total: lateInvoices[0]?.total ?? 0,
          items: lateInvoices.map((i) => ({ id: i.id, invoice_number: i.number, client: i.client, due_date: i.due, balance_due: Number(i.balance), days_late: i.days })),
        },
        projects_due: {
          total: dueProjects[0]?.total ?? 0,
          items: dueProjects.map((p) => ({ id: p.id, title: p.title, deadline: p.deadline, days_left: p.days_left })),
        },
        overdue_tasks: {
          total: lateTasks[0]?.total ?? 0,
          items: lateTasks.map((t) => ({ id: t.id, title: t.title, project: t.project, end_date: t.end_date })),
        },
        overdue_expenses: {
          total: lateExpenses[0]?.total ?? 0,
          items: lateExpenses.map((e) => ({ id: e.id, title: e.title, amount_ttc: Number(e.amount), due_date: e.due })),
        },
      },
    };
  }

  // ---------- Projets et production (13.3) ----------

  async projects(viewer: AuthenticatedUser, query: DashboardQueryDto) {
    const ctx = await this.context.load(viewer.companyId);
    const period = resolvePeriod(ctx.today, query);
    const key = this.cache.key('projects', ctx.companyId, 'managers', [period.month, period.months]);
    return this.cache.serve(key, query.refresh === true, () => this.computeProjects(ctx, period));
  }

  private async computeProjects(ctx: DashboardContext, period: ReturnType<typeof resolvePeriod>) {
    const { companyId, timeZone, today } = ctx;
    const rules = DASHBOARD_RULES;
    const weeksFrom = weekRange(addDays(today, -7 * (rules.throughputWeeks - 1))).from;

    const [statuses, created, delivered, active, budgets, funnel, throughput, workload, leadTime] = await Promise.all([
      this.operations.projectStatusCounts(companyId),
      this.operations.projectsCreatedByMonth(companyId, period.windowFrom, period.windowTo, timeZone),
      this.operations.projectsDeliveredByMonth(companyId, period.windowFrom, period.windowTo, timeZone),
      this.operations.activeProjects(companyId, 200),
      this.operations.budgetUsage(companyId, 100),
      this.operations.taskFunnel(companyId),
      this.operations.weeklyThroughput(companyId, weeksFrom, timeZone),
      this.operations.workload(companyId),
      this.operations.leadTime(companyId, period.windowFrom, period.windowTo, timeZone),
    ]);

    // ----- Avancement et projets à risque -----
    const progressed = active.items.map((p) => {
      const progress = p.total > 0 ? Math.round((p.done * 100) / p.total) : 0;
      const daysLeft = p.deadline ? dayOrdinal(p.deadline) - dayOrdinal(today) : null;
      let risk: 'overdue' | 'low_progress' | null = null;
      if (daysLeft !== null && daysLeft < 0) risk = 'overdue';
      else if (daysLeft !== null && daysLeft <= rules.projectAtRiskDays && progress < rules.projectAtRiskProgress) risk = 'low_progress';
      return { ...p, progress, daysLeft, risk };
    });
    const atRisk = progressed
      .filter((p) => p.risk)
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      .slice(0, 20);

    // ----- Débit hebdomadaire (semaines vides comprises) -----
    const weeks = Array.from({ length: rules.throughputWeeks }, (_, i) => weekRange(addDays(today, -7 * (rules.throughputWeeks - 1 - i))).from);

    return {
      period: periodView(period),
      thresholds: { at_risk_days: rules.projectAtRiskDays, at_risk_progress_percent: rules.projectAtRiskProgress },

      status_distribution: {
        current: [...statuses].sort((a, b) => PROJECT_ORDER.concat('delivered').indexOf(a.status) - PROJECT_ORDER.concat('delivered').indexOf(b.status))
          .map((s) => ({ status: s.status, count: s.n })),
        evolution: monthsBetween(period.windowFromMonth, period.month).map((month) => ({
          month, created: created.get(month) ?? 0, delivered: delivered.get(month) ?? 0,
        })),
        delivered_source: 'audit_log',
        chart: CHARTS.statusDonut,
      },

      at_risk: {
        total: atRisk.length,
        projects: atRisk.map((p) => ({
          id: p.id, title: p.title, client: p.client, deadline: p.deadline, days_left: p.daysLeft,
          progress: p.progress, reason: p.risk,
        })),
      },

      progress: {
        active_projects: active.total,
        projects: progressed.slice(0, 50).map((p) => ({
          id: p.id, title: p.title, client: p.client, status: p.status, deadline: p.deadline, days_left: p.daysLeft,
          progress: p.progress, tasks: { total: p.total, done: p.done },
        })),
        chart: { type: 'horizontal_bar', x: 'title', y: ['progress'], unit: 'percent' },
      },

      budget_vs_consumed: {
        projects: budgets
          .map((b) => ({
            id: b.id, title: b.title, budget_ht: round2(b.budget), consumed_ht: round2(b.consumed),
            consumed_percent: pct(b.consumed, b.budget), over_budget: b.consumed > b.budget,
          }))
          .sort((a, b) => (b.consumed_percent ?? 0) - (a.consumed_percent ?? 0))
          .slice(0, 20),
        chart: { type: 'horizontal_bar', x: 'title', y: ['budget_ht', 'consumed_ht'], unit: 'currency' },
      },

      task_funnel: {
        stages: TASK_ORDER.map((status) => ({ status, count: funnel.find((f) => f.status === status)?.n ?? 0 })),
        weekly_throughput: weeks.map((week) => ({ week, done: throughput.get(week) ?? 0 })),
        chart: CHARTS.funnel,
        throughput_chart: CHARTS.weeklyBar,
      },

      workload: {
        people: workload.map((w) => ({
          user: person(w), open: w.open, overdue: w.overdue, done_last_30_days: w.done30,
          overloaded: w.open >= rules.workloadOpenTasks || w.overdue >= rules.workloadOverdueTasks,
        })),
        thresholds: { open_tasks: rules.workloadOpenTasks, overdue_tasks: rules.workloadOverdueTasks },
        chart: CHARTS.workload,
      },

      lead_time: {
        completed_tasks: leadTime.count,
        average_days: leadTime.avgDays === null ? null : round2(leadTime.avgDays),
        median_days: leadTime.medianDays === null ? null : round2(leadTime.medianDays),
        chart: CHARTS.daysKpi,
      },
    };
  }
}