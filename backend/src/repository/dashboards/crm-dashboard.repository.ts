import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { inLocalRange } from '../../services/dashboards/dashboard-support.js';

const SIGN = `(CASE WHEN i.type = 'invoice' THEN 1 ELSE -1 END)`;
const REVENUE = `i.type IN ('invoice', 'credit_note') AND i.status IN ('sent', 'overdue', 'paid')`;
const BALANCE = `(i.total_ttc - i.amount_paid - i.credited_total)`;

@Injectable()
export class CrmDashboardRepository {
  constructor(private readonly dataSource: DataSource) {}

  private q<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  async newClientsByMonth(companyId: string, from: string, to: string, tz: string) {
    const [rows, before] = await Promise.all([
      this.q<{ month: string; n: number }>(
        `SELECT to_char(created_at AT TIME ZONE $4::text, 'YYYY-MM') AS month, COUNT(*)::int AS n
           FROM clients WHERE company_id = $1 AND ${inLocalRange('created_at', '$2', '$3', '$4')} GROUP BY 1`,
        [companyId, from, to, tz],
      ),
      this.q<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM clients
          WHERE company_id = $1 AND created_at < ($2::date)::timestamp AT TIME ZONE $3::text`,
        [companyId, from, tz],
      ),
    ]);
    return { byMonth: new Map(rows.map((r) => [r.month, r.n])), totalBefore: before[0].n };
  }

  interactionsByType(companyId: string, from: string, to: string, tz: string) {
    return this.q<{ type: string; n: number }>(
      `SELECT type, COUNT(*)::int AS n FROM interactions
        WHERE company_id = $1 AND ${inLocalRange('interaction_date', '$2', '$3', '$4')}
        GROUP BY 1 ORDER BY 2 DESC, 1 ASC`,
      [companyId, from, to, tz],
    );
  }

  interactionsByUser(companyId: string, from: string, to: string, tz: string) {
    return this.q<{ id: string | null; name: string | null; n: number }>(
      `SELECT u.id, u.name, COUNT(*)::int AS n
         FROM interactions x LEFT JOIN users u ON u.id = x.user_id AND u.company_id = x.company_id
        WHERE x.company_id = $1 AND ${inLocalRange('x.interaction_date', '$2', '$3', '$4')}
        GROUP BY u.id, u.name ORDER BY 3 DESC, u.name ASC NULLS LAST`,
      [companyId, from, to, tz],
    );
  }

  async interactionsByMonth(companyId: string, from: string, to: string, tz: string) {
    const rows = await this.q<{ month: string; n: number }>(
      `SELECT to_char(interaction_date AT TIME ZONE $4::text, 'YYYY-MM') AS month, COUNT(*)::int AS n
         FROM interactions WHERE company_id = $1 AND ${inLocalRange('interaction_date', '$2', '$3', '$4')} GROUP BY 1`,
      [companyId, from, to, tz],
    );
    return new Map(rows.map((r) => [r.month, r.n]));
  }

  /** Clients actifs sans interaction depuis `before` (ou jamais, et créés avant). */
  async clientsToFollowUp(companyId: string, before: Date, limit: number) {
    const rows = await this.q<{
      id: string; name: string; contact: string | null; email: string | null; phone: string | null;
      last: Date | null; total: number;
    }>(
      `SELECT c.id, c.company_name AS name, c.contact_name AS contact, c.email, c.phone,
              li.last, COUNT(*) OVER()::int AS total
         FROM clients c
         LEFT JOIN LATERAL (SELECT MAX(x.interaction_date) AS last FROM interactions x
                             WHERE x.company_id = c.company_id AND x.client_id = c.id) li ON true
        WHERE c.company_id = $1 AND c.archived_at IS NULL AND COALESCE(li.last, c.created_at) < $2::timestamptz
        ORDER BY COALESCE(li.last, c.created_at) ASC, c.id ASC
        LIMIT $3`,
      [companyId, before, limit],
    );
    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((r) => ({ id: r.id, name: r.name, contact: r.contact, email: r.email, phone: r.phone, lastInteractionAt: r.last })),
    };
  }

  /** Valeur par client : CA net de la période, projets actifs, solde dû. */
  async clientValue(companyId: string, currency: string, from: string, to: string, limit: number) {
    const rows = await this.q<{ id: string; name: string; revenue: string; projects: number; balance: string }>(
      `SELECT * FROM (
         SELECT c.id, c.company_name AS name,
                COALESCE((SELECT SUM(${SIGN} * i.total_ht) FROM invoices i
                           WHERE i.company_id = c.company_id AND i.client_id = c.id AND ${REVENUE}
                             AND i.currency = $2 AND i.issue_date >= $3::date AND i.issue_date <= $4::date), 0)::text AS revenue,
                (SELECT COUNT(*)::int FROM projects p
                  WHERE p.company_id = c.company_id AND p.client_id = c.id AND p.archived_at IS NULL) AS projects,
                COALESCE((SELECT SUM(${BALANCE}) FROM invoices i
                           WHERE i.company_id = c.company_id AND i.client_id = c.id AND i.type = 'invoice'
                             AND i.status IN ('sent', 'overdue') AND i.currency = $2 AND ${BALANCE} > 0), 0)::text AS balance
           FROM clients c WHERE c.company_id = $1 AND c.archived_at IS NULL
       ) x
        WHERE x.revenue::numeric <> 0 OR x.balance::numeric <> 0 OR x.projects > 0
        ORDER BY x.revenue::numeric DESC, x.balance::numeric DESC, x.name ASC, x.id ASC
        LIMIT $5`,
      [companyId, currency, from, to, limit],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, revenueHt: Number(r.revenue), projects: r.projects, balanceDue: Number(r.balance) }));
  }

  /** Clients les plus actifs depuis `sinceDate` : interactions et factures émises. */
  async mostActive(companyId: string, sinceDate: string, tz: string, limit: number) {
    const rows = await this.q<{ id: string; name: string; interactions: number; invoices: number }>(
      `SELECT * FROM (
         SELECT c.id, c.company_name AS name,
                (SELECT COUNT(*)::int FROM interactions x
                  WHERE x.company_id = c.company_id AND x.client_id = c.id
                    AND x.interaction_date >= ($2::date)::timestamp AT TIME ZONE $3::text) AS interactions,
                (SELECT COUNT(*)::int FROM invoices i
                  WHERE i.company_id = c.company_id AND i.client_id = c.id AND i.type = 'invoice'
                    AND i.status IN ('sent', 'overdue', 'paid') AND i.issue_date >= $2::date) AS invoices
           FROM clients c WHERE c.company_id = $1 AND c.archived_at IS NULL
       ) x
        WHERE x.interactions + x.invoices > 0
        ORDER BY x.interactions + x.invoices DESC, x.name ASC, x.id ASC
        LIMIT $4`,
      [companyId, sinceDate, tz, limit],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, interactions: r.interactions, invoices: r.invoices }));
  }

  /** Clients actifs sans interaction, facture ni projet depuis `sinceDate`. */
  async dormant(companyId: string, sinceDate: string, tz: string, limit: number) {
    const rows = await this.q<{ id: string; name: string; last: Date | null; total: number }>(
      `SELECT c.id, c.company_name AS name, la.last, COUNT(*) OVER()::int AS total
         FROM clients c
         LEFT JOIN LATERAL (
           SELECT GREATEST(
                    (SELECT MAX(x.interaction_date) FROM interactions x WHERE x.company_id = c.company_id AND x.client_id = c.id),
                    (SELECT MAX(i.issue_date)::timestamp AT TIME ZONE $3::text FROM invoices i
                      WHERE i.company_id = c.company_id AND i.client_id = c.id AND i.status IN ('sent', 'overdue', 'paid')),
                    (SELECT MAX(p.created_at) FROM projects p WHERE p.company_id = c.company_id AND p.client_id = c.id)) AS last) la ON true
        WHERE c.company_id = $1 AND c.archived_at IS NULL
          AND c.created_at < ($2::date)::timestamp AT TIME ZONE $3::text
          AND (la.last IS NULL OR la.last < ($2::date)::timestamp AT TIME ZONE $3::text)
        ORDER BY la.last ASC NULLS FIRST, c.id ASC
        LIMIT $4`,
      [companyId, sinceDate, tz, limit],
    );
    return { total: rows[0]?.total ?? 0, items: rows.map((r) => ({ id: r.id, name: r.name, lastActivityAt: r.last })) };
  }
}