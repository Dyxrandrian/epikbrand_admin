import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { inLocalRange } from '../../services/dashboards/dashboard-support.js';

export interface LeaveSpanRow {
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  type: string;
}

const MAX_SPANS = 20_000;

@Injectable()
export class HrDashboardRepository {
  constructor(private readonly dataSource: DataSource) {}

  private q<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  async headcount(companyId: string, from: string, to: string, tz: string) {
    const [byRole, byTitle, flags] = await Promise.all([
      this.q<{ role: string; n: number }>(
        `SELECT role::text AS role, COUNT(*)::int AS n FROM users WHERE company_id = $1 AND is_active = true GROUP BY 1`,
        [companyId],
      ),
      this.q<{ title: string; n: number }>(
        `SELECT COALESCE(NULLIF(btrim(job_title), ''), 'Non renseigné') AS title, COUNT(*)::int AS n
           FROM users WHERE company_id = $1 AND is_active = true GROUP BY 1 ORDER BY 2 DESC, 1 ASC`,
        [companyId],
      ),
      this.q<{ total: number; invited: number; arrivals: number }>(
        `SELECT COUNT(*)::int AS total,
                (COUNT(*) FILTER (WHERE password_hash IS NULL))::int AS invited,
                (COUNT(*) FILTER (WHERE ${inLocalRange('created_at', '$2', '$3', '$4')}))::int AS arrivals
           FROM users WHERE company_id = $1 AND is_active = true`,
        [companyId, from, to, tz],
      ),
    ]);
    return { total: flags[0].total, invitedPending: flags[0].invited, arrivals: flags[0].arrivals, byRole, byTitle };
  }

  /** Demandes en attente, de la plus ancienne à la plus récente, avec leur délai d'attente en jours. */
  async pendingLeave(companyId: string, today: string, tz: string, limit: number) {
    const rows = await this.q<{
      id: string; user_id: string; name: string; type: string; start: string; end: string;
      days: string; waiting: number; total: number;
    }>(
      `SELECT r.id, u.id AS user_id, u.name, lt.name AS type,
              to_char(r.start_date, 'YYYY-MM-DD') AS start, to_char(r.end_date, 'YYYY-MM-DD') AS end,
              r.days_count::text AS days,
              ($2::date - (r.created_at AT TIME ZONE $3::text)::date) AS waiting, COUNT(*) OVER()::int AS total
         FROM leave_requests r
         JOIN users u ON u.id = r.user_id AND u.company_id = r.company_id
         JOIN leave_types lt ON lt.id = r.leave_type_id AND lt.company_id = r.company_id
        WHERE r.company_id = $1 AND r.status = 'pending'
        ORDER BY r.created_at ASC, r.id ASC LIMIT $4`,
      [companyId, today, tz, limit],
    );
    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((r) => ({
        id: r.id, userId: r.user_id, name: r.name, type: r.type, startDate: r.start, endDate: r.end,
        days: Number(r.days), waitingDays: r.waiting,
      })),
    };
  }

  async pendingTraining(companyId: string, today: string, tz: string, limit: number) {
    const rows = await this.q<{ id: string; user_id: string; name: string; training: string; waiting: number; total: number }>(
      `SELECT r.id, u.id AS user_id, u.name, r.training_name AS training,
              ($2::date - (r.created_at AT TIME ZONE $3::text)::date) AS waiting, COUNT(*) OVER()::int AS total
         FROM training_requests r JOIN users u ON u.id = r.user_id AND u.company_id = r.company_id
        WHERE r.company_id = $1 AND r.status = 'pending'
        ORDER BY r.created_at ASC, r.id ASC LIMIT $4`,
      [companyId, today, tz, limit],
    );
    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name, training: r.training, waitingDays: r.waiting })),
    };
  }

  /** Congés approuvés qui touchent la fenêtre : base du taux d'absence. */
  approvedSpans(companyId: string, from: string, to: string): Promise<LeaveSpanRow[]> {
    return this.q<LeaveSpanRow>(
      `SELECT to_char(r.start_date, 'YYYY-MM-DD') AS "startDate", to_char(r.end_date, 'YYYY-MM-DD') AS "endDate",
              r.start_half_day AS "startHalfDay", r.end_half_day AS "endHalfDay", lt.name AS type
         FROM leave_requests r JOIN leave_types lt ON lt.id = r.leave_type_id AND lt.company_id = r.company_id
        WHERE r.company_id = $1 AND r.status = 'approved' AND r.start_date <= $3::date AND r.end_date >= $2::date
        LIMIT ${MAX_SPANS}`,
      [companyId, from, to],
    );
  }
}