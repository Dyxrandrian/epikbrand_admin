import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { addDays } from '../services/hr/leave-calendar.js';
import { notificationTemplates } from '../services/notifications/notification-templates.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import {
  MAX_INDIVIDUAL_NOTIFICATIONS,
  errorMessage,
  moneyText,
  notifyUpTo,
} from './job-helpers.js';
import type { CompanyJob, CompanyJobContext, JobResult } from './job.types.js';

type When = 'today' | 'tomorrow';

interface TaskRow {
  id: string;
  title: string;
  dueOn: string;
  assigneeIds: string[];
}
interface ProjectRow {
  id: string;
  title: string;
  dueOn: string;
  memberIds: string[];
}
interface InvoiceRow {
  id: string;
  number: string;
  dueOn: string;
  clientName: string;
  currency: string;
  balance: string;
}
interface ExpenseRow {
  id: string;
  title: string;
  dueOn: string;
  amount: string;
}

@Injectable()
export class DueRemindersJob implements CompanyJob {
  readonly name = 'due-reminders';
  readonly scope = 'company' as const;
  readonly description =
    "Rappels la veille et le jour de l'échéance : tâches, projets, factures et dépenses ; alerte sur les dépenses devenues échues.";

  private readonly logger = new Logger(DueRemindersJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
  ) {}

  async run(ctx: CompanyJobContext): Promise<JobResult> {
    const tomorrow = addDays(ctx.today, 1);
    const yesterday = addDays(ctx.today, -1);
    const managers = await this.notifications.managerIds(ctx.companyId);
    const whenOf = (dueOn: string): When => (dueOn === ctx.today ? 'today' : 'tomorrow');

    // Chaque section est indépendante : l'échec de l'une n'empêche pas les autres
    const sections: Array<[string, () => Promise<number>]> = [
      ['tasks', () => this.tasks(ctx, tomorrow, whenOf)],
      ['projects', () => this.projects(ctx, tomorrow, managers, whenOf)],
      ['invoices', () => this.invoices(ctx, tomorrow, managers, whenOf)],
      ['expenses_due', () => this.expensesDue(ctx, tomorrow, managers, whenOf)],
      ['expenses_overdue', () => this.expensesOverdue(ctx, yesterday, managers)],
    ];

    const result: JobResult = {};
    const errors: Record<string, string> = {};
    for (const [name, section] of sections) {
      try {
        result[name] = await section();
      } catch (error) {
        errors[name] = errorMessage(error);
        this.logger.error(`Section « ${name} » en échec`, error as Error);
      }
    }

    // Tout a échoué : la tâche sera retentée. Sinon, succès (les erreurs partielles sont notées).
    if (Object.keys(errors).length === sections.length) {
      throw new Error(`Toutes les sections ont échoué : ${JSON.stringify(errors)}`);
    }
    if (Object.keys(errors).length > 0) result.errors = errors;
    return result;
  }

  // ---------- Tâches : un rappel par personne et par jour ----------

  private async tasks(
    ctx: CompanyJobContext,
    tomorrow: string,
    whenOf: (dueOn: string) => When,
  ): Promise<number> {
    const rows: TaskRow[] = await this.dataSource.query(
      `SELECT t.id,
              t.title,
              (t.end_date AT TIME ZONE $2::text)::date::text AS "dueOn",
              array_agg(ta.user_id)::text[] AS "assigneeIds"
         FROM tasks t
         JOIN task_assignees ta ON ta.task_id = t.id
        WHERE t.company_id = $1
          AND t.archived_at IS NULL
          AND t.status <> 'done'
          AND t.end_date >= (($3::date)::timestamp AT TIME ZONE $2::text)
          AND t.end_date < ((($4::date + 1))::timestamp AT TIME ZONE $2::text)
        GROUP BY t.id
        ORDER BY t.end_date ASC, t.id ASC`,
      [ctx.companyId, ctx.timeZone, ctx.today, tomorrow],
    );

    const byUser = new Map<string, Record<When, Array<{ id: string; title: string }>>>();
    for (const row of rows) {
      const when = whenOf(row.dueOn);
      for (const userId of row.assigneeIds) {
        const entry = byUser.get(userId) ?? { today: [], tomorrow: [] };
        entry[when].push({ id: row.id, title: row.title });
        byUser.set(userId, entry);
      }
    }

    let sent = 0;
    for (const [userId, groups] of byUser) {
      for (const when of ['today', 'tomorrow'] as const) {
        if (groups[when].length === 0) continue;
        await this.notifications.notify({
          companyId: ctx.companyId,
          recipientIds: [userId],
          ...notificationTemplates.tasksDue(groups[when], when),
        });
        sent += 1;
      }
    }
    return sent;
  }

  // ---------- Projets : membres et managers ----------

  private async projects(
    ctx: CompanyJobContext,
    tomorrow: string,
    managers: string[],
    whenOf: (dueOn: string) => When,
  ): Promise<number> {
    const rows: ProjectRow[] = await this.dataSource.query(
      `SELECT p.id,
              p.title,
              to_char(p.deadline, 'YYYY-MM-DD') AS "dueOn",
              COALESCE((SELECT array_agg(DISTINCT ta.user_id)::text[]
                          FROM tasks t
                          JOIN task_assignees ta ON ta.task_id = t.id
                         WHERE t.company_id = p.company_id
                           AND t.project_id = p.id
                           AND t.archived_at IS NULL), ARRAY[]::text[]) AS "memberIds"
         FROM projects p
        WHERE p.company_id = $1
          AND p.archived_at IS NULL
          AND p.status <> 'delivered'
          AND p.deadline IN ($2::date, $3::date)
        ORDER BY p.deadline ASC, p.id ASC`,
      [ctx.companyId, ctx.today, tomorrow],
    );

    for (const row of rows) {
      await this.notifications.notify({
        companyId: ctx.companyId,
        recipientIds: [...new Set([...managers, ...row.memberIds])],
        ...notificationTemplates.projectDue({ id: row.id, title: row.title }, whenOf(row.dueOn)),
      });
    }
    return rows.length;
  }

  // ---------- Factures : managers ----------

  private async invoices(
    ctx: CompanyJobContext,
    tomorrow: string,
    managers: string[],
    whenOf: (dueOn: string) => When,
  ): Promise<number> {
    const rows: InvoiceRow[] = await this.dataSource.query(
      `SELECT i.id,
              i.invoice_number AS "number",
              to_char(i.due_date, 'YYYY-MM-DD') AS "dueOn",
              cl.company_name AS "clientName",
              i.currency,
              (i.total_ttc - i.amount_paid - i.credited_total)::text AS balance
         FROM invoices i
         JOIN clients cl ON cl.id = i.client_id AND cl.company_id = i.company_id
        WHERE i.company_id = $1
          AND i.type = 'invoice'
          AND i.status = 'sent'
          AND i.due_date IN ($2::date, $3::date)
          AND i.total_ttc - i.amount_paid - i.credited_total > 0
        ORDER BY i.due_date ASC, i.id ASC`,
      [ctx.companyId, ctx.today, tomorrow],
    );

    for (const when of ['today', 'tomorrow'] as const) {
      await notifyUpTo(
        rows.filter((row) => whenOf(row.dueOn) === when),
        MAX_INDIVIDUAL_NOTIFICATIONS,
        (row) =>
          this.notifications.notify({
            companyId: ctx.companyId,
            recipientIds: managers,
            ...notificationTemplates.invoiceDue(
              {
                id: row.id,
                number: row.number,
                clientName: row.clientName,
                balance: moneyText(row.balance, row.currency),
              },
              when,
            ),
          }),
        (remaining) =>
          this.notifications.notify({
            companyId: ctx.companyId,
            recipientIds: managers,
            ...notificationTemplates.invoicesDue(remaining, when),
          }),
      );
    }
    return rows.length;
  }

  // ---------- Dépenses : à payer aujourd'hui ou demain ----------

  private async expensesDue(
    ctx: CompanyJobContext,
    tomorrow: string,
    managers: string[],
    whenOf: (dueOn: string) => When,
  ): Promise<number> {
    const rows: ExpenseRow[] = await this.dataSource.query(
      `SELECT e.id, e.title, to_char(e.due_date, 'YYYY-MM-DD') AS "dueOn", e.amount_ttc::text AS amount
         FROM expenses e
        WHERE e.company_id = $1
          AND e.status = 'pending'
          AND e.due_date IN ($2::date, $3::date)
        ORDER BY e.due_date ASC, e.id ASC`,
      [ctx.companyId, ctx.today, tomorrow],
    );

    for (const when of ['today', 'tomorrow'] as const) {
      await notifyUpTo(
        rows.filter((row) => whenOf(row.dueOn) === when),
        MAX_INDIVIDUAL_NOTIFICATIONS,
        (row) =>
          this.notifications.notify({
            companyId: ctx.companyId,
            recipientIds: managers,
            ...notificationTemplates.expenseDue(
              { id: row.id, title: row.title, amount: moneyText(row.amount, ctx.currency) },
              when,
            ),
          }),
        (remaining) =>
          this.notifications.notify({
            companyId: ctx.companyId,
            recipientIds: managers,
            ...notificationTemplates.expensesDue(remaining, when),
          }),
      );
    }
    return rows.length;
  }

  // ---------- Dépenses devenues échues (échéance : hier), une seule fois ----------

  private async expensesOverdue(
    ctx: CompanyJobContext,
    yesterday: string,
    managers: string[],
  ): Promise<number> {
    const rows: ExpenseRow[] = await this.dataSource.query(
      `SELECT e.id, e.title, to_char(e.due_date, 'YYYY-MM-DD') AS "dueOn", e.amount_ttc::text AS amount
         FROM expenses e
        WHERE e.company_id = $1
          AND e.status = 'pending'
          AND e.due_date = $2::date
        ORDER BY e.id ASC`,
      [ctx.companyId, yesterday],
    );

    await notifyUpTo(
      rows,
      MAX_INDIVIDUAL_NOTIFICATIONS,
      (row) =>
        this.notifications.notify({
          companyId: ctx.companyId,
          recipientIds: managers,
          ...notificationTemplates.expenseOverdue({
            id: row.id,
            title: row.title,
            amount: moneyText(row.amount, ctx.currency),
            dueDate: row.dueOn,
          }),
        }),
      (remaining) =>
        this.notifications.notify({
          companyId: ctx.companyId,
          recipientIds: managers,
          ...notificationTemplates.expensesOverdue(remaining),
        }),
    );
    return rows.length;
  }
}