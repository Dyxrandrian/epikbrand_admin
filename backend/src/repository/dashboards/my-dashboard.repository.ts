import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface MyTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  end_date: Date | null;
  project: string;
}

@Injectable()
export class MyDashboardRepository {
  constructor(private readonly dataSource: DataSource) {}

  private q<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  async tasks(companyId: string, userId: string) {
    const [byStatus, open] = await Promise.all([
      this.q<{ status: string; n: number }>(
        `SELECT t.status::text AS status, COUNT(*)::int AS n
           FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $2
          WHERE t.company_id = $1 AND t.archived_at IS NULL GROUP BY 1`,
        [companyId, userId],
      ),
      this.q<MyTask>(
        `SELECT t.id, t.title, t.status::text AS status, t.priority::text AS priority, t.end_date, p.title AS project
           FROM tasks t
           JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $2
           JOIN projects p ON p.id = t.project_id AND p.company_id = t.company_id
          WHERE t.company_id = $1 AND t.archived_at IS NULL AND t.status <> 'done'
          ORDER BY t.end_date ASC NULLS LAST, t.id ASC LIMIT 500`,
        [companyId, userId],
      ),
    ]);
    return { byStatus, open };
  }

  async leaveRequests(companyId: string, userId: string, limit: number) {
    const [counts, recent] = await Promise.all([
      this.q<{ status: string; n: number }>(
        `SELECT status::text AS status, COUNT(*)::int AS n FROM leave_requests
          WHERE company_id = $1 AND user_id = $2 GROUP BY 1`,
        [companyId, userId],
      ),
      this.q<{ id: string; type: string; start: string; end: string; days: string; status: string }>(
        `SELECT r.id, lt.name AS type, to_char(r.start_date, 'YYYY-MM-DD') AS start,
                to_char(r.end_date, 'YYYY-MM-DD') AS end, r.days_count::text AS days, r.status::text AS status
           FROM leave_requests r JOIN leave_types lt ON lt.id = r.leave_type_id AND lt.company_id = r.company_id
          WHERE r.company_id = $1 AND r.user_id = $2
          ORDER BY r.created_at DESC, r.id ASC LIMIT $3`,
        [companyId, userId, limit],
      ),
    ]);
    return { counts, recent };
  }

  async notifications(companyId: string, userId: string, limit: number) {
    const [recent, unread] = await Promise.all([
      this.q<{ id: string; type: string | null; title: string; is_read: boolean; redirect_url: string | null; created_at: Date }>(
        `SELECT id, type, title, is_read, redirect_url, created_at FROM notifications
          WHERE company_id = $1 AND user_id = $2 ORDER BY created_at DESC, id ASC LIMIT $3`,
        [companyId, userId, limit],
      ),
      this.q<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM notifications WHERE company_id = $1 AND user_id = $2 AND is_read = false`,
        [companyId, userId],
      ),
    ]);
    return { recent, unread: unread[0].n };
  }

  projects(companyId: string, userId: string, limit: number) {
    return this.q<{
      id: string; title: string; status: string; deadline: string | null; my_open: number; total: number; done: number;
    }>(
      `SELECT p.id, p.title, p.status::text AS status, to_char(p.deadline, 'YYYY-MM-DD') AS deadline,
              a.my_open, s.total, s.done
         FROM projects p
         JOIN LATERAL (SELECT (COUNT(*) FILTER (WHERE t.status <> 'done'))::int AS my_open
                         FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = $2
                        WHERE t.company_id = p.company_id AND t.project_id = p.id AND t.archived_at IS NULL
                       HAVING COUNT(*) > 0) a ON true
         JOIN LATERAL (SELECT COUNT(*)::int AS total, (COUNT(*) FILTER (WHERE status = 'done'))::int AS done
                         FROM tasks WHERE company_id = p.company_id AND project_id = p.id AND archived_at IS NULL) s ON true
        WHERE p.company_id = $1 AND p.archived_at IS NULL AND p.status <> 'delivered'
        ORDER BY p.deadline ASC NULLS LAST, p.id ASC LIMIT $3`,
      [companyId, userId, limit],
    );
  }

  /** Alimenté par l'historique « récents » de l'étape suivante ; vide tant qu'il n'est pas enregistré. */
  recentArticles(companyId: string, userId: string, limit: number) {
    return this.q<{ id: string; title: string; viewed_at: Date }>(
      `SELECT a.id, a.title, rv.viewed_at
         FROM recent_views rv
         JOIN agency_articles a ON a.id = rv.entity_id AND a.company_id = $1 AND a.archived_at IS NULL
        WHERE rv.user_id = $2 AND rv.entity_type = 'article'
        ORDER BY rv.viewed_at DESC LIMIT $3`,
      [companyId, userId, limit],
    );
  }

  /** Bulletins payés : métadonnées seulement (aucun montant ; la fiche détaillée est journalisée). */
  payslips(companyId: string, userId: string, limit: number) {
    return this.q<{ id: string; month: string; payment_date: string | null }>(
      `SELECT id, month, to_char(payment_date, 'YYYY-MM-DD') AS payment_date FROM salaries
        WHERE company_id = $1 AND user_id = $2 AND status = 'paid' ORDER BY month DESC LIMIT $3`,
      [companyId, userId, limit],
    );
  }

  async expenses(companyId: string, userId: string) {
    const rows = await this.q<{ pending: number; awaiting: number }>(
      `SELECT (COUNT(*) FILTER (WHERE status = 'pending'))::int AS pending,
              (COUNT(*) FILTER (WHERE status = 'pending' AND validated_at IS NULL))::int AS awaiting
         FROM expenses WHERE company_id = $1 AND user_id = $2`,
      [companyId, userId],
    );
    return rows[0];
  }
}