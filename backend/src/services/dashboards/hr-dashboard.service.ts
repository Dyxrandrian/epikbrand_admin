import { Injectable } from '@nestjs/common';
import type { DashboardQueryDto } from '../../dto/dashboards/dashboard-query.dto.js';
import { HrDashboardRepository } from '../../repository/dashboards/hr-dashboard.repository.js';
import type { LeaveSpanRow } from '../../repository/dashboards/hr-dashboard.repository.js';
import { LeaveRequestRepository } from '../../repository/leave-request.repository.js';
import { TrainingRequestRepository } from '../../repository/training-request.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { eachDay, isWorkingDay } from '../hr/leave-calendar.js';
import { monthsBetween } from '../payroll/payroll-calendar.js';
import { monthRange, weekRange } from '../projects/project-dates.js';
import { DashboardCacheService } from './dashboard-cache.js';
import { CHARTS } from './dashboard-meta.js';
import { DASHBOARD_RULES } from './dashboard-rules.js';
import { DashboardContextService, pct, periodView, resolvePeriod, round2 } from './dashboard-support.js';
import type { DashboardContext, Period } from './dashboard-support.js';

const maxDate = (a: string, b: string): string => (a > b ? a : b);
const minDate = (a: string, b: string): string => (a < b ? a : b);

/** Jours d'absence d'un congé, par mois (jours ouvrés seulement, demi-journées comprises). */
function absenceByMonth(span: LeaveSpanRow, from: string, to: string): Map<string, number> {
  const byMonth = new Map<string, number>();
  const start = maxDate(span.startDate, from);
  const end = minDate(span.endDate, to);
  if (start > end) return byMonth;

  for (const date of eachDay(start, end)) {
    if (!isWorkingDay(date)) continue;
    let halves = 2;
    if (date === span.startDate && span.startHalfDay) halves -= 1;
    if (date === span.endDate && span.endHalfDay) halves -= 1;
    if (halves > 0) byMonth.set(date.slice(0, 7), (byMonth.get(date.slice(0, 7)) ?? 0) + halves / 2);
  }
  return byMonth;
}

@Injectable()
export class HrDashboardService {
  constructor(
    private readonly context: DashboardContextService,
    private readonly cache: DashboardCacheService,
    private readonly hr: HrDashboardRepository,
    private readonly leaves: LeaveRequestRepository,
    private readonly trainings: TrainingRequestRepository,
  ) {}

  async get(viewer: AuthenticatedUser, query: DashboardQueryDto) {
    const ctx = await this.context.load(viewer.companyId);
    const period = resolvePeriod(ctx.today, query);
    const key = this.cache.key('hr', ctx.companyId, 'managers', [period.month, period.months]);
    return this.cache.serve(key, query.refresh === true, () => this.compute(ctx, period));
  }

  private async compute(ctx: DashboardContext, period: Period) {
    const { companyId, timeZone, today } = ctx;
    const week = weekRange(today);

    const [weekLeaves, headcount, pendingLeave, pendingTraining, spans, approvedTrainings] = await Promise.all([
      this.leaves.approvedOverlapping(companyId, week.from, week.to),
      this.hr.headcount(companyId, period.from, period.to, timeZone),
      this.hr.pendingLeave(companyId, today, timeZone, 20),
      this.hr.pendingTraining(companyId, today, timeZone, 20),
      this.hr.approvedSpans(companyId, period.windowFrom, period.windowTo),
      this.trainings.approvedInPeriod(companyId, { from: period.from, to: period.to, timeZone }),
    ]);

    // ----- Absents aujourd'hui et cette semaine -----
    const absent = (r: (typeof weekLeaves)[number]) => ({
      request_id: r.id,
      user: { id: r.user.id, name: r.user.name, avatar_url: r.user.avatarUrl, job_title: r.user.jobTitle },
      leave_type: { id: r.leaveType.id, name: r.leaveType.name },
      start_date: r.startDate, end_date: r.endDate, days_count: r.daysCount,
    });
    const workingToday = isWorkingDay(today);

    // ----- Taux d'absence par mois et par type (effectif actuel) -----
    const typeNames = new Set<string>();
    const days = new Map<string, Map<string, number>>(); // mois -> type -> jours
    for (const span of spans) {
      for (const [month, count] of absenceByMonth(span, period.windowFrom, period.windowTo)) {
        typeNames.add(span.type);
        const perType = days.get(month) ?? new Map<string, number>();
        perType.set(span.type, (perType.get(span.type) ?? 0) + count);
        days.set(month, perType);
      }
    }
    const absenceMonths = monthsBetween(period.windowFromMonth, period.month).map((month) => {
      const range = monthRange(`${month}-01`);
      const workingDays = eachDay(range.from, range.to).filter(isWorkingDay).length;
      const perType = days.get(month) ?? new Map<string, number>();
      const totalDays = [...perType.values()].reduce((s, d) => s + d, 0);
      return {
        month,
        absence_days: round2(totalDays),
        working_days: workingDays,
        rate_percent: pct(totalDays, headcount.total * workingDays),
        by_type: [...typeNames].sort().map((type) => ({ type, days: round2(perType.get(type) ?? 0) })).filter((t) => t.days > 0),
      };
    });

    // ----- Formations approuvées de la période, par personne -----
    const people = new Map<string, { id: string; name: string; trainings: string[] }>();
    for (const t of approvedTrainings) {
      const entry = people.get(t.userId) ?? { id: t.userId, name: t.user.name, trainings: [] };
      entry.trainings.push(t.trainingName);
      people.set(t.userId, entry);
    }

    const waitStats = (items: Array<{ waitingDays: number }>) => ({
      oldest_waiting_days: items.length > 0 ? Math.max(...items.map((i) => i.waitingDays)) : 0,
      average_waiting_days: items.length > 0 ? round2(items.reduce((s, i) => s + i.waitingDays, 0) / items.length) : 0,
    });

    return {
      period: periodView(period),
      definitions: { absence_rate: 'Jours d’absence approuvés ÷ (effectif actuel × jours ouvrés du mois). Jours fériés non déduits.' },

      absences: {
        today: {
          date: today,
          is_working_day: workingToday,
          people: workingToday
            ? weekLeaves.filter((r) => r.startDate <= today && today <= r.endDate).map(absent)
            : [],
        },
        this_week: { from: week.from, to: week.to, people: weekLeaves.map(absent) },
      },

      pending_requests: {
        leave: { total: pendingLeave.total, ...waitStats(pendingLeave.items), items: pendingLeave.items },
        training: { total: pendingTraining.total, ...waitStats(pendingTraining.items), items: pendingTraining.items },
      },

      absence_rate: { months: absenceMonths, chart: CHARTS.percentLine },

      headcount: {
        active: headcount.total,
        invited_not_accepted: headcount.invitedPending,
        new_arrivals_in_month: headcount.arrivals,
        by_role: headcount.byRole.map((r) => ({ role: r.role, count: r.n })),
        by_job_title: headcount.byTitle.map((r) => ({ job_title: r.title, count: r.n })),
        chart: { type: 'donut', x: 'job_title', y: ['count'], unit: 'count' },
      },

      trainings: {
        month: period.month,
        approved: approvedTrainings.length,
        people: [...people.values()].sort((a, b) => b.trainings.length - a.trainings.length || a.name.localeCompare(b.name, 'fr'))
          .map((p) => ({ user_id: p.id, name: p.name, count: p.trainings.length, trainings: p.trainings })),
      },
    };
  }
}