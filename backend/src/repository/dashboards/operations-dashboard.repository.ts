import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { inLocalRange } from '../../services/dashboards/dashboard-support.js';

const ISSUED = `('sent', 'overdue', 'paid')`;
const BALANCE = `(i.total_ttc - i.amount_paid - i.credited_total)`;
const OPEN = `i.type = 'invoice' AND i.status IN ('sent', 'overdue') AND ${BALANCE} > 0`;

export interface ActiveProject {
  id: string;
  title: string;
  status: string;
  deadline: string | null;
  client: string;
  total: number;
  done: number;
}

export interface WorkloadRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  open: number;
  overdue: number;
  done30: number;
}

@Injectable()
export class OperationsDashboardRepository {
  constructor(private readonly dataSource: DataSource) {}

  private q<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  // ---------- Projets et tâches ----------

  projectStatusCounts(companyId: string) {
    return this.q<{ status: string; n: number }>(
      `SELECT status::text AS status, COUNT(*)::int AS n
         FROM projects WHERE company_id = $1 AND archived_at IS NULL GROUP BY 1`,
      [companyId],
    );
  }

  async projectsCreatedByMonth(companyId: string, from: string, to: string, tz: string) {
    const rows = await this.q<{ month: string; n: number }>(
      `SELECT to_char(created_at AT TIME ZONE $4::text, 'YYYY-MM') AS month, COUNT(*)::int AS n
         FROM projects WHERE company_id = $1 AND ${inLocalRange('created_at', '$2', '$3', '$4')}
        GROUP BY 1`,
      [companyId, from, to, tz],
    );
    return new Map(rows.map((r) => [r.month, r.n]));
  }

  /** La date de livraison n'est pas stockée : elle est déduite des changements de statut du journal d'audit. */
  async projectsDeliveredByMonth(companyId: string, from: string, to: string, tz: string) {
    const rows = await this.q<{ month: string; n: number }>(
      `SELECT to_char(created_at AT TIME ZONE $4::text, 'YYYY-MM') AS month, COUNT(DISTINCT entity_id)::int AS n
         FROM audit_logs
        WHERE company_id = $1 AND entity_type = 'project' AND action = 'update'
          AND changes->'after'->>'status' = 'delivered'
          AND ${inLocalRange('created_at', '$2', '$3', '$4')}
        GROUP BY 1`,
      [companyId, from, to, tz],
    );
    return new Map(rows.map((r) => [r.month, r.n]));
  }

  async activeProjects(companyId: string, limit: number): Promise<{ total: number; items: ActiveProject[] }> {
    const rows = await this.q<{
      id: string; title: string; status: string; deadline: string | null; client: string;
      total: number; done: number; all_count: number;
    }>(
      `SELECT p.id, p.title, p.status::text AS status, to_char(p.deadline, 'YYYY-MM-DD') AS deadline,
              c.company_name AS client, s.total, s.done, COUNT(*) OVER()::int AS all_count
         FROM projects p
         JOIN clients c ON c.id = p.client_id AND c.company_id = p.company_id
         JOIN LATERAL (SELECT COUNT(*)::int AS total, (COUNT(*) FILTER (WHERE t.status = 'done'))::int AS done
                         FROM tasks t
                        WHERE t.company_id = p.company_id AND t.project_id = p.id AND t.archived_at IS NULL) s ON true
        WHERE p.company_id = $1 AND p.archived_at IS NULL AND p.status <> 'delivered'
        ORDER BY p.deadline ASC NULLS LAST, p.title ASC, p.id ASC
        LIMIT $2`,
      [companyId, limit],
    );
    return {
      total: rows[0]?.all_count ?? 0,
      items: rows.map((r) => ({
        id: r.id, title: r.title, status: r.status, deadline: r.deadline,
        client: r.client, total: r.total, done: r.done,
      })),
    };
  }

  /** Budget prévu et dépenses (HT, hors annulées) des projets actifs qui ont un budget. */
  async budgetUsage(companyId: string, limit: number) {
    const rows = await this.q<{ id: string; title: string; budget: string; consumed: string }>(
      `SELECT p.id, p.title, p.budget_ht::text AS budget,
              COALESCE((SELECT SUM(e.amount_ht) FROM expenses e
                         WHERE e.company_id = p.company_id AND e.project_id = p.id AND e.status <> 'cancelled'), 0)::text AS consumed
         FROM projects p
        WHERE p.company_id = $1 AND p.archived_at IS NULL AND p.status <> 'delivered' AND p.budget_ht > 0
        ORDER BY p.title ASC, p.id ASC
        LIMIT $2`,
      [companyId, limit],
    );
    return rows.map((r) => ({ id: r.id, title: r.title, budget: Number(r.budget), consumed: Number(r.consumed) }));
  }

  taskFunnel(companyId: string) {
    return this.q<{ status: string; n: number }>(
      `SELECT status::text AS status, COUNT(*)::int AS n
         FROM tasks WHERE company_id = $1 AND archived_at IS NULL GROUP BY 1`,
      [companyId],
    );
  }

  async weeklyThroughput(companyId: string, fromDate: string, tz: string) {
    const rows = await this.q<{ week: string; n: number }>(
      `SELECT to_char(date_trunc('week', completed_at AT TIME ZONE $2::text), 'YYYY-MM-DD') AS week, COUNT(*)::int AS n
         FROM tasks
        WHERE company_id = $1 AND status = 'done' AND archived_at IS NULL
          AND completed_at >= ($3::date)::timestamp AT TIME ZONE $2::text
        GROUP BY 1`,
      [companyId, tz, fromDate],
    );
    return new Map(rows.map((r) => [r.week, r.n]));
  }

  async workload(companyId: string): Promise<WorkloadRow[]> {
    const rows = await this.q<{
      id: string; name: string; avatar_url: string | null; job_title: string | null;
      open: number; overdue: number; done30: number;
    }>(
      `SELECT u.id, u.name, u.avatar_url, u.job_title,
              (COUNT(t.id) FILTER (WHERE t.status <> 'done'))::int AS open,
              (COUNT(t.id) FILTER (WHERE t.status <> 'done' AND t.end_date IS NOT NULL AND t.end_date < now()))::int AS overdue,
              (COUNT(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at >= now() - interval '30 days'))::int AS done30
         FROM users u
         LEFT JOIN task_assignees ta ON ta.user_id = u.id
         LEFT JOIN tasks t ON t.id = ta.task_id AND t.company_id = u.company_id AND t.archived_at IS NULL
        WHERE u.company_id = $1 AND u.is_active = true
        GROUP BY u.id
        ORDER BY 5 DESC, u.name ASC, u.id ASC`,
      [companyId],
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, avatarUrl: r.avatar_url, jobTitle: r.job_title,
      open: r.open, overdue: r.overdue, done30: r.done30,
    }));
  }

  /** Délai entre la création et la fin des tâches terminées dans la période (en jours). */
  async leadTime(companyId: string, from: string, to: string, tz: string) {
    const rows = await this.q<{ n: number; avg: string | null; median: string | null }>(
      `SELECT COUNT(*)::int AS n,
              AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400)::text AS avg,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400))::text AS median
         FROM tasks
        WHERE company_id = $1 AND status = 'done' AND archived_at IS NULL AND completed_at IS NOT NULL
          AND ${inLocalRange('completed_at', '$2', '$3', '$4')}`,
      [companyId, from, to, tz],
    );
    const r = rows[0];
    return { count: r.n, avgDays: r.avg === null ? null : Number(r.avg), medianDays: r.median === null ? null : Number(r.median) };
  }

  async topTeam(companyId: string, from: string, to: string, tz: string, limit: number) {
    const rows = await this.q<{
      id: string; name: string; avatar_url: string | null; job_title: string | null; done: number; on_time: number;
    }>(
      `SELECT u.id, u.name, u.avatar_url, u.job_title,
              COUNT(DISTINCT t.id)::int AS done,
              (COUNT(DISTINCT t.id) FILTER (WHERE t.end_date IS NULL OR t.completed_at <= t.end_date))::int AS on_time
         FROM tasks t
         JOIN task_assignees ta ON ta.task_id = t.id
         JOIN users u ON u.id = ta.user_id AND u.company_id = t.company_id
        WHERE t.company_id = $1 AND t.status = 'done' AND t.archived_at IS NULL
          AND ${inLocalRange('t.completed_at', '$2', '$3', '$4')}
        GROUP BY u.id, u.name, u.avatar_url, u.job_title
        ORDER BY 5 DESC, u.name ASC, u.id ASC
        LIMIT $5`,
      [companyId, from, to, tz, limit],
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, avatarUrl: r.avatar_url, jobTitle: r.job_title, completed: r.done, onTime: r.on_time,
    }));
  }

  // ---------- Tableau de bord général ----------

  async generalCounts(companyId: string, currency: string, today: string, from: string, to: string, tz: string) {
    const rows = await this.q<Record<string, string | number>>(
      `SELECT
         (SELECT COUNT(*)::int FROM projects WHERE company_id = $1 AND archived_at IS NULL AND status = 'ongoing') AS ongoing_projects,
         (SELECT COUNT(*)::int FROM tasks WHERE company_id = $1 AND archived_at IS NULL AND status <> 'done') AS open_tasks,
         (SELECT COUNT(*)::int FROM tasks WHERE company_id = $1 AND archived_at IS NULL AND status <> 'done' AND end_date < now()) AS overdue_tasks,
         (SELECT COUNT(*)::int FROM clients WHERE company_id = $1 AND archived_at IS NULL) AS active_clients,
         (SELECT COUNT(*)::int FROM clients WHERE company_id = $1 AND ${inLocalRange('created_at', '$4', '$5', '$6')}) AS new_clients,
         (SELECT COUNT(*)::int FROM invoices i WHERE i.company_id = $1 AND i.currency = $2 AND ${OPEN}) AS unpaid_count,
         (SELECT COALESCE(SUM(${BALANCE}), 0)::text FROM invoices i WHERE i.company_id = $1 AND i.currency = $2 AND ${OPEN}) AS unpaid_total,
         (SELECT COUNT(*)::int FROM invoices i WHERE i.company_id = $1 AND i.currency = $2 AND ${OPEN} AND i.due_date < $3::date) AS overdue_count,
         (SELECT COALESCE(SUM(${BALANCE}), 0)::text FROM invoices i WHERE i.company_id = $1 AND i.currency = $2 AND ${OPEN} AND i.due_date < $3::date) AS overdue_total,
         (SELECT COUNT(*)::int FROM leave_requests WHERE company_id = $1 AND status = 'pending') AS pending_leave,
         (SELECT COUNT(*)::int FROM training_requests WHERE company_id = $1 AND status = 'pending') AS pending_training,
         (SELECT COUNT(*)::int FROM expenses WHERE company_id = $1 AND status = 'pending' AND validated_at IS NULL) AS pending_expenses`,
      [companyId, currency, today, from, to, tz],
    );
    const r = rows[0];
    return {
      ongoingProjects: Number(r.ongoing_projects), openTasks: Number(r.open_tasks), overdueTasks: Number(r.overdue_tasks),
      activeClients: Number(r.active_clients), newClients: Number(r.new_clients),
      unpaidCount: Number(r.unpaid_count), unpaidTotal: Number(r.unpaid_total),
      overdueCount: Number(r.overdue_count), overdueTotal: Number(r.overdue_total),
      pendingLeave: Number(r.pending_leave), pendingTraining: Number(r.pending_training),
      pendingExpenses: Number(r.pending_expenses),
    };
  }

  recentClients(companyId: string, limit: number) {
    return this.q<{ id: string; name: string; created_at: Date }>(
      `SELECT id, company_name AS name, created_at FROM clients
        WHERE company_id = $1 AND archived_at IS NULL ORDER BY created_at DESC, id ASC LIMIT $2`,
      [companyId, limit],
    );
  }

  recentTasks(companyId: string, limit: number) {
    return this.q<{ id: string; title: string; status: string; project: string; created_at: Date }>(
      `SELECT t.id, t.title, t.status::text AS status, p.title AS project, t.created_at
         FROM tasks t JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
        WHERE t.company_id = $1 AND t.archived_at IS NULL
        ORDER BY t.created_at DESC, t.id ASC LIMIT $2`,
      [companyId, limit],
    );
  }

  recentInvoices(companyId: string, limit: number) {
    return this.q<{
      id: string; number: string | null; type: string; status: string; total_ttc: string;
      currency: string; client: string; created_at: Date;
    }>(
      `SELECT i.id, i.invoice_number AS number, i.type::text AS type, i.status::text AS status,
              i.total_ttc::text AS total_ttc, i.currency, c.company_name AS client, i.created_at
         FROM invoices i JOIN clients c ON c.id = i.client_id AND c.company_id = i.company_id
        WHERE i.company_id = $1 ORDER BY i.created_at DESC, i.id ASC LIMIT $2`,
      [companyId, limit],
    );
  }

  recentInteractions(companyId: string, limit: number) {
    return this.q<{
      id: string; type: string; summary: string; date: Date; client_id: string; client: string; author: string | null;
    }>(
      `SELECT x.id, x.type, x.summary, x.interaction_date AS date, c.id AS client_id,
              c.company_name AS client, u.name AS author
         FROM interactions x
         JOIN clients c ON c.id = x.client_id AND c.company_id = x.company_id
         LEFT JOIN users u ON u.id = x.user_id AND u.company_id = x.company_id
        WHERE x.company_id = $1 ORDER BY x.interaction_date DESC, x.id ASC LIMIT $2`,
      [companyId, limit],
    );
  }

  // ---------- Alertes ----------

  overdueInvoices(companyId: string, currency: string, today: string, limit: number) {
    return this.q<{
      id: string; number: string; client: string; due: string; balance: string; days: number; total: number;
    }>(
      `SELECT i.id, i.invoice_number AS number, c.company_name AS client,
              to_char(i.due_date, 'YYYY-MM-DD') AS due, ${BALANCE}::text AS balance,
              ($3::date - i.due_date) AS days, COUNT(*) OVER()::int AS total
         FROM invoices i JOIN clients c ON c.id = i.client_id AND c.company_id = i.company_id
        WHERE i.company_id = $1 AND i.currency = $2 AND ${OPEN} AND i.due_date < $3::date
        ORDER BY i.due_date ASC, i.id ASC LIMIT $4`,
      [companyId, currency, today, limit],
    );
  }

  /** Projets non livrés dont l'échéance est dépassée ou tombe dans les `days` jours. */
  projectsDueSoon(companyId: string, today: string, days: number, limit: number) {
    return this.q<{ id: string; title: string; deadline: string; days_left: number; total: number }>(
      `SELECT p.id, p.title, to_char(p.deadline, 'YYYY-MM-DD') AS deadline,
              (p.deadline - $2::date) AS days_left, COUNT(*) OVER()::int AS total
         FROM projects p
        WHERE p.company_id = $1 AND p.archived_at IS NULL AND p.status <> 'delivered'
          AND p.deadline IS NOT NULL AND p.deadline <= $2::date + $3::int
        ORDER BY p.deadline ASC, p.id ASC LIMIT $4`,
      [companyId, today, days, limit],
    );
  }

  overdueTasks(companyId: string, limit: number) {
    return this.q<{ id: string; title: string; end_date: Date; project: string; total: number }>(
      `SELECT t.id, t.title, t.end_date, p.title AS project, COUNT(*) OVER()::int AS total
         FROM tasks t JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
        WHERE t.company_id = $1 AND t.archived_at IS NULL AND t.status <> 'done' AND t.end_date < now()
        ORDER BY t.end_date ASC, t.id ASC LIMIT $2`,
      [companyId, limit],
    );
  }

  overdueExpenses(companyId: string, today: string, limit: number) {
    return this.q<{ id: string; title: string; amount: string; due: string; total: number }>(
      `SELECT e.id, e.title, e.amount_ttc::text AS amount, to_char(e.due_date, 'YYYY-MM-DD') AS due,
              COUNT(*) OVER()::int AS total
         FROM expenses e
        WHERE e.company_id = $1 AND e.status = 'pending' AND e.due_date < $2::date
        ORDER BY e.due_date ASC, e.id ASC LIMIT $3`,
      [companyId, today, limit],
    );
  }

  // ---------- « À faire pour moi » ----------

  async todo(companyId: string, userId: string, today: string, tz: string) {
    const [tasks, counts] = await Promise.all([
      this.q<{ id: string; title: string; status: string; end_date: Date; project: string }>(
        `SELECT t.id, t.title, t.status::text AS status, t.end_date, p.title AS project
           FROM tasks t
           JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $2
           JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
          WHERE t.company_id = $1 AND t.archived_at IS NULL AND t.status <> 'done'
            AND t.end_date IS NOT NULL AND t.end_date < (($3::date + 1))::timestamp AT TIME ZONE $4::text
          ORDER BY t.end_date ASC, t.id ASC LIMIT 10`,
        [companyId, userId, today, tz],
      ),
      this.q<{ leave: number; training: number; expenses: number; unread: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM leave_requests WHERE company_id = $1 AND status = 'pending' AND user_id <> $2) AS leave,
           (SELECT COUNT(*)::int FROM training_requests WHERE company_id = $1 AND status = 'pending' AND user_id <> $2) AS training,
           (SELECT COUNT(*)::int FROM expenses WHERE company_id = $1 AND status = 'pending' AND validated_at IS NULL
               AND (user_id IS NULL OR user_id <> $2)) AS expenses,
           (SELECT COUNT(*)::int FROM notifications WHERE company_id = $1 AND user_id = $2 AND is_read = false) AS unread`,
        [companyId, userId],
      ),
    ]);
    return { tasks, ...counts[0] };
  }
}