import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExpenseRecurrence } from '../../enums/app.enums.js';

const SIGN = `(CASE WHEN i.type = 'invoice' THEN 1 ELSE -1 END)`;
const REVENUE = `i.type IN ('invoice', 'credit_note') AND i.status IN ('sent', 'overdue', 'paid')`;
const ISSUED_INVOICE = `i.type = 'invoice' AND i.status IN ('sent', 'overdue', 'paid')`;
const BALANCE = `(i.total_ttc - i.amount_paid - i.credited_total)`;
const OPEN = `i.type = 'invoice' AND i.status IN ('sent', 'overdue') AND ${BALANCE} > 0`;
const CONVERTED = `EXISTS (SELECT 1 FROM invoices f WHERE f.company_id = q.company_id AND f.source_document_id = q.id AND f.type = 'invoice' AND f.status <> 'cancelled')`;

interface DayRow { date: string; amount: string }
export type DayAmounts = Map<string, number>;

const toMap = (rows: DayRow[]): DayAmounts => new Map(rows.map((row) => [row.date, Number(row.amount)]));

export interface QuoteMonth {
  month: string;
  sent: number;
  accepted: number;
  rejected: number;
  converted: number;
  quotedHt: number;
  convertedHt: number;
}

export interface TemplateRow {
  id: string;
  recurrence: ExpenseRecurrence;
  expenseDate: string;
  amountTtc: string;
  lastGenerated: string | null;
}

export type BreakdownDimension = 'category' | 'supplier' | 'project';

const BREAKDOWN: Record<BreakdownDimension, { key: string; label: string; join: string }> = {
  category: {
    key: `COALESCE(c.id::text, 'none')`,
    label: `COALESCE(c.name, 'Sans catégorie')`,
    join: `LEFT JOIN expense_categories c ON c.id = e.category_id AND c.company_id = e.company_id`,
  },
  supplier: {
    key: `lower(btrim(e.supplier_name))`,
    label: `e.supplier_name`,
    join: ``,
  },
  project: {
    key: `COALESCE(p.id::text, 'none')`,
    label: `COALESCE(p.title, 'Sans projet')`,
    join: `LEFT JOIN projects p ON p.id = e.project_id AND p.company_id = e.company_id`,
  },
};

@Injectable()
export class FinanceDashboardRepository {
  constructor(private readonly dataSource: DataSource) {}

  private q<T>(sql: string, params: unknown[]): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  /** CA net par mois : factures moins avoirs. */
  async revenueByMonth(companyId: string, currency: string, from: string, to: string) {
    const rows = await this.q<{ month: string; ht: string; ttc: string; n: number }>(
      `SELECT to_char(i.issue_date, 'YYYY-MM') AS month,
              COALESCE(SUM(${SIGN} * i.total_ht), 0)::text AS ht,
              COALESCE(SUM(${SIGN} * i.total_ttc), 0)::text AS ttc,
              (COUNT(*) FILTER (WHERE i.type = 'invoice'))::int AS n
         FROM invoices i
        WHERE i.company_id = $1 AND ${REVENUE} AND i.currency = $2
          AND i.issue_date >= $3::date AND i.issue_date <= $4::date
        GROUP BY 1 ORDER BY 1`,
      [companyId, currency, from, to],
    );
    return rows.map((r) => ({ month: r.month, revenueHt: Number(r.ht), revenueTtc: Number(r.ttc), invoices: r.n }));
  }

  async collectedByMonth(companyId: string, currency: string, from: string, to: string) {
    const rows = await this.q<{ month: string; amount: string }>(
      `SELECT to_char(p.paid_at, 'YYYY-MM') AS month, SUM(p.amount)::text AS amount
         FROM invoice_payments p
         JOIN invoices i ON i.id = p.invoice_id AND i.company_id = p.company_id
        WHERE p.company_id = $1 AND i.currency = $2 AND p.paid_at >= $3::date AND p.paid_at <= $4::date
        GROUP BY 1`,
      [companyId, currency, from, to],
    );
    return new Map(rows.map((r) => [r.month, Number(r.amount)]));
  }

  /** Dépenses hors annulées, par date de dépense. */
  async expensesByMonth(companyId: string, from: string, to: string) {
    const rows = await this.q<{ month: string; ht: string; vat: string; ttc: string }>(
      `SELECT to_char(e.expense_date, 'YYYY-MM') AS month,
              SUM(e.amount_ht)::text AS ht, SUM(e.vat_amount)::text AS vat, SUM(e.amount_ttc)::text AS ttc
         FROM expenses e
        WHERE e.company_id = $1 AND e.status <> 'cancelled'
          AND e.expense_date >= $2::date AND e.expense_date <= $3::date
        GROUP BY 1`,
      [companyId, from, to],
    );
    return new Map(rows.map((r) => [r.month, { ht: Number(r.ht), vat: Number(r.vat), ttc: Number(r.ttc) }]));
  }

  /** Flux de trésorerie par jour : paiements reçus, dépenses payées, salaires payés (si demandés). */
  async cashDaily(
    companyId: string,
    currency: string,
    from: string,
    to: string,
    includeSalaries: boolean,
  ) {
    const [inflows, expenses, salaries] = await Promise.all([
      this.q<DayRow>(
        `SELECT to_char(p.paid_at, 'YYYY-MM-DD') AS date, SUM(p.amount)::text AS amount
           FROM invoice_payments p
           JOIN invoices i ON i.id = p.invoice_id AND i.company_id = p.company_id
          WHERE p.company_id = $1 AND i.currency = $2 AND p.paid_at >= $3::date AND p.paid_at <= $4::date
          GROUP BY 1`,
        [companyId, currency, from, to],
      ),
      this.q<DayRow>(
        `SELECT to_char(e.paid_at, 'YYYY-MM-DD') AS date, SUM(e.amount_ttc)::text AS amount
           FROM expenses e
          WHERE e.company_id = $1 AND e.status = 'paid' AND e.paid_at >= $2::date AND e.paid_at <= $3::date
          GROUP BY 1`,
        [companyId, from, to],
      ),
      includeSalaries
        ? this.q<DayRow>(
            `SELECT to_char(s.payment_date, 'YYYY-MM-DD') AS date, SUM(s.net_salary)::text AS amount
               FROM salaries s
              WHERE s.company_id = $1 AND s.status = 'paid'
                AND s.payment_date >= $2::date AND s.payment_date <= $3::date
              GROUP BY 1`,
            [companyId, from, to],
          )
        : Promise.resolve([] as DayRow[]),
    ]);
    return { inflows: toMap(inflows), expenses: toMap(expenses), salaries: toMap(salaries) };
  }

  async inflowsByMethod(companyId: string, currency: string, from: string, to: string) {
    const rows = await this.q<{ method: string; amount: string; n: number }>(
      `SELECT p.method::text AS method, SUM(p.amount)::text AS amount, COUNT(*)::int AS n
         FROM invoice_payments p
         JOIN invoices i ON i.id = p.invoice_id AND i.company_id = p.company_id
        WHERE p.company_id = $1 AND i.currency = $2 AND p.paid_at >= $3::date AND p.paid_at <= $4::date
        GROUP BY 1 ORDER BY SUM(p.amount) DESC`,
      [companyId, currency, from, to],
    );
    return rows.map((r) => ({ method: r.method, amount: Number(r.amount), payments: r.n }));
  }

  /** Recouvrement : factures dont l'échéance tombe dans [from, to]. */
  async collection(companyId: string, currency: string, from: string, to: string, today: string) {
    const rows = await this.q<{ n: number; due: string; settled: string; overdue_open: string }>(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(i.total_ttc), 0)::text AS due,
              COALESCE(SUM(LEAST(i.amount_paid + i.credited_total, i.total_ttc)), 0)::text AS settled,
              COALESCE(SUM(${BALANCE}) FILTER (WHERE i.due_date < $5::date AND ${BALANCE} > 0), 0)::text AS overdue_open
         FROM invoices i
        WHERE i.company_id = $1 AND ${ISSUED_INVOICE} AND i.currency = $2
          AND i.due_date >= $3::date AND i.due_date <= $4::date`,
      [companyId, currency, from, to, today],
    );
    const r = rows[0];
    return { invoices: r.n, dueTtc: Number(r.due), settledTtc: Number(r.settled), overdueOpenTtc: Number(r.overdue_open) };
  }

  /** Créances ouvertes par ancienneté (jours depuis l'échéance). */
  async receivables(companyId: string, currency: string, today: string) {
    const rows = await this.q<Record<string, string | number>>(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(b), 0)::text AS total,
              COALESCE(SUM(b) FILTER (WHERE due_date IS NULL OR due_date >= $3::date), 0)::text AS not_due,
              COALESCE(SUM(b) FILTER (WHERE $3::date - due_date BETWEEN 1 AND 30), 0)::text AS d0_30,
              COALESCE(SUM(b) FILTER (WHERE $3::date - due_date BETWEEN 31 AND 60), 0)::text AS d31_60,
              COALESCE(SUM(b) FILTER (WHERE $3::date - due_date BETWEEN 61 AND 90), 0)::text AS d61_90,
              COALESCE(SUM(b) FILTER (WHERE $3::date - due_date > 90), 0)::text AS d90_plus
         FROM (SELECT i.due_date, ${BALANCE} AS b
                 FROM invoices i
                WHERE i.company_id = $1 AND i.currency = $2 AND ${OPEN}) x`,
      [companyId, currency, today],
    );
    const r = rows[0];
    return {
      count: Number(r.n),
      total: Number(r.total),
      buckets: [
        { bucket: 'not_due', amount: Number(r.not_due) },
        { bucket: '0_30', amount: Number(r.d0_30) },
        { bucket: '31_60', amount: Number(r.d31_60) },
        { bucket: '61_90', amount: Number(r.d61_90) },
        { bucket: '90_plus', amount: Number(r.d90_plus) },
      ],
    };
  }

  async receivablesByClient(companyId: string, currency: string, today: string, limit: number) {
    const rows = await this.q<{ id: string; name: string; n: number; due: string; overdue_n: number; oldest: string | null }>(
      `SELECT c.id, c.company_name AS name, COUNT(*)::int AS n, SUM(${BALANCE})::text AS due,
              (COUNT(*) FILTER (WHERE i.due_date < $3::date))::int AS overdue_n,
              to_char(MIN(i.due_date) FILTER (WHERE i.due_date < $3::date), 'YYYY-MM-DD') AS oldest
         FROM invoices i
         JOIN clients c ON c.id = i.client_id AND c.company_id = i.company_id
        WHERE i.company_id = $1 AND i.currency = $2 AND ${OPEN}
        GROUP BY c.id, c.company_name
        ORDER BY SUM(${BALANCE}) DESC, c.id ASC
        LIMIT $4`,
      [companyId, currency, today, limit],
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, invoices: r.n, due: Number(r.due),
      overdueInvoices: r.overdue_n, oldestDueDate: r.oldest,
    }));
  }

  async topClients(companyId: string, currency: string, from: string, to: string, limit: number) {
    const rows = await this.q<{ id: string; name: string; ht: string; n: number }>(
      `SELECT c.id, c.company_name AS name, SUM(${SIGN} * i.total_ht)::text AS ht,
              (COUNT(*) FILTER (WHERE i.type = 'invoice'))::int AS n
         FROM invoices i
         JOIN clients c ON c.id = i.client_id AND c.company_id = i.company_id
        WHERE i.company_id = $1 AND ${REVENUE} AND i.currency = $2
          AND i.issue_date >= $3::date AND i.issue_date <= $4::date
        GROUP BY c.id, c.company_name
       HAVING SUM(${SIGN} * i.total_ht) > 0
        ORDER BY SUM(${SIGN} * i.total_ht) DESC, c.id ASC
        LIMIT $5`,
      [companyId, currency, from, to, limit],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, revenueHt: Number(r.ht), invoices: r.n }));
  }

  /** « Offre » = intitulé des lignes de facture (casse, accents et espaces ignorés). */
  async topOffers(companyId: string, currency: string, from: string, to: string, limit: number) {
    const rows = await this.q<{ label: string; ht: string; qty: string; docs: number }>(
      `SELECT (array_agg(it.description ORDER BY i.issue_date DESC, i.id ASC))[1] AS label,
              SUM(${SIGN} * it.total_ht)::text AS ht,
              SUM(${SIGN} * it.quantity)::text AS qty,
              COUNT(DISTINCT i.id)::int AS docs
         FROM invoice_items it
         JOIN invoices i ON i.id = it.invoice_id
        WHERE i.company_id = $1 AND ${REVENUE} AND i.currency = $2
          AND i.issue_date >= $3::date AND i.issue_date <= $4::date
        GROUP BY lower(btrim(regexp_replace(f_unaccent(it.description), '\\s+', ' ', 'g')))
       HAVING SUM(${SIGN} * it.total_ht) > 0
        ORDER BY SUM(${SIGN} * it.total_ht) DESC, 1 ASC
        LIMIT $5`,
      [companyId, currency, from, to, limit],
    );
    return rows.map((r) => ({
      label: r.label.length > 120 ? `${r.label.slice(0, 119)}…` : r.label,
      revenueHt: Number(r.ht), quantity: Number(r.qty), documents: r.docs,
    }));
  }

  /** Commandes : devis acceptés dans la période + factures émises sans devis d'origine. */
  async orders(companyId: string, currency: string, from: string, to: string, timeZone: string) {
    const rows = await this.q<{ source: string; n: number; total: string }>(
      `SELECT 'quote' AS source, COUNT(*)::int AS n, COALESCE(SUM(i.total_ht), 0)::text AS total
         FROM invoices i
        WHERE i.company_id = $1 AND i.type = 'quote' AND i.status <> 'cancelled' AND i.currency = $2
          AND i.accepted_at >= ($3::date)::timestamp AT TIME ZONE $5::text
          AND i.accepted_at < (($4::date + 1))::timestamp AT TIME ZONE $5::text
       UNION ALL
       SELECT 'invoice', COUNT(*)::int, COALESCE(SUM(i.total_ht), 0)::text
         FROM invoices i
        WHERE i.company_id = $1 AND ${ISSUED_INVOICE} AND i.source_document_id IS NULL AND i.currency = $2
          AND i.issue_date >= $3::date AND i.issue_date <= $4::date`,
      [companyId, currency, from, to, timeZone],
    );
    const pick = (source: string) => {
      const row = rows.find((r) => r.source === source);
      return { count: row?.n ?? 0, totalHt: Number(row?.total ?? 0) };
    };
    return { quotes: pick('quote'), directInvoices: pick('invoice') };
  }

  /** Devis émis par mois : acceptés, refusés, convertis en facture. */
  async quoteConversion(companyId: string, currency: string, from: string, to: string): Promise<QuoteMonth[]> {
    const rows = await this.q<Record<string, string | number>>(
      `SELECT to_char(q.issue_date, 'YYYY-MM') AS month,
              COUNT(*)::int AS sent,
              (COUNT(*) FILTER (WHERE q.accepted_at IS NOT NULL))::int AS accepted,
              (COUNT(*) FILTER (WHERE q.rejected_at IS NOT NULL))::int AS rejected,
              (COUNT(*) FILTER (WHERE ${CONVERTED}))::int AS converted,
              COALESCE(SUM(q.total_ht), 0)::text AS quoted_ht,
              COALESCE(SUM(q.total_ht) FILTER (WHERE ${CONVERTED}), 0)::text AS converted_ht
         FROM invoices q
        WHERE q.company_id = $1 AND q.type = 'quote' AND q.status = 'sent' AND q.currency = $2
          AND q.issue_date >= $3::date AND q.issue_date <= $4::date
        GROUP BY 1 ORDER BY 1`,
      [companyId, currency, from, to],
    );
    return rows.map((r) => ({
      month: String(r.month), sent: Number(r.sent), accepted: Number(r.accepted),
      rejected: Number(r.rejected), converted: Number(r.converted),
      quotedHt: Number(r.quoted_ht), convertedHt: Number(r.converted_ht),
    }));
  }

  async expenseBreakdown(
    companyId: string,
    from: string,
    to: string,
    dimension: BreakdownDimension,
    limit: number,
  ) {
    const d = BREAKDOWN[dimension];
    const rows = await this.q<{ id: string; label: string; ht: string; ttc: string; n: number }>(
      `SELECT ${d.key} AS id, MIN(${d.label}) AS label,
              SUM(e.amount_ht)::text AS ht, SUM(e.amount_ttc)::text AS ttc, COUNT(*)::int AS n
         FROM expenses e ${d.join}
        WHERE e.company_id = $1 AND e.status <> 'cancelled'
          AND e.expense_date >= $2::date AND e.expense_date <= $3::date
        GROUP BY 1
        ORDER BY SUM(e.amount_ht) DESC, 1 ASC
        LIMIT $4`,
      [companyId, from, to, limit],
    );
    return rows.map((r) => ({ id: r.id, label: r.label, amountHt: Number(r.ht), amountTtc: Number(r.ttc), count: r.n }));
  }

  /** Factures ouvertes par échéance : mois, « overdue » (échue) ou « undated ». */
  async forecastInflows(companyId: string, currency: string, today: string) {
    const rows = await this.q<{ bucket: string; amount: string; n: number }>(
      `SELECT CASE WHEN i.due_date IS NULL THEN 'undated'
                   WHEN i.due_date < $3::date THEN 'overdue'
                   ELSE to_char(i.due_date, 'YYYY-MM') END AS bucket,
              SUM(${BALANCE})::text AS amount, COUNT(*)::int AS n
         FROM invoices i
        WHERE i.company_id = $1 AND i.currency = $2 AND ${OPEN}
        GROUP BY 1`,
      [companyId, currency, today],
    );
    return new Map(rows.map((r) => [r.bucket, { amount: Number(r.amount), count: r.n }]));
  }

  async forecastExpenses(companyId: string, today: string) {
    const rows = await this.q<{ bucket: string; amount: string; n: number }>(
      `SELECT CASE WHEN e.due_date IS NULL THEN 'undated'
                   WHEN e.due_date < $2::date THEN 'overdue'
                   ELSE to_char(e.due_date, 'YYYY-MM') END AS bucket,
              SUM(e.amount_ttc)::text AS amount, COUNT(*)::int AS n
         FROM expenses e
        WHERE e.company_id = $1 AND e.status = 'pending'
        GROUP BY 1`,
      [companyId, today],
    );
    return new Map(rows.map((r) => [r.bucket, { amount: Number(r.amount), count: r.n }]));
  }

  /** Modèles de dépenses récurrentes (même sélection que la tâche de génération). */
  recurringTemplates(companyId: string): Promise<TemplateRow[]> {
    return this.q<TemplateRow>(
      `SELECT e.id, e.recurrence::text AS recurrence,
              to_char(e.expense_date, 'YYYY-MM-DD') AS "expenseDate",
              e.amount_ttc::text AS "amountTtc",
              (SELECT to_char(MAX(c.expense_date), 'YYYY-MM-DD')
                 FROM expenses c WHERE c.company_id = e.company_id AND c.parent_expense_id = e.id) AS "lastGenerated"
         FROM expenses e
        WHERE e.company_id = $1 AND e.is_recurring = true AND e.status <> 'cancelled' AND e.recurrence IS NOT NULL`,
      [companyId],
    );
  }

  /** Documents dans une autre devise : exclus de tous les montants. */
  async otherCurrencyDocuments(companyId: string, currency: string, from: string, to: string): Promise<number> {
    const rows = await this.q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM invoices i
        WHERE i.company_id = $1 AND i.currency <> $2 AND i.status IN ('sent', 'overdue', 'paid')
          AND i.issue_date >= $3::date AND i.issue_date <= $4::date`,
      [companyId, currency, from, to],
    );
    return rows[0].n;
  }
}