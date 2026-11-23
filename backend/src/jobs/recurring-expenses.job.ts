import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { ExpenseRecurrence } from '../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../enums/audit.enums.js';
import { AuditService } from '../services/audit/audit.service.js';
import { notificationTemplates } from '../services/notifications/notification-templates.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import { addDays } from '../services/hr/leave-calendar.js';
import { maxDate } from './job-helpers.js';
import { occurrenceDate } from './recurrence.js';
import type { CompanyJob, CompanyJobContext, JobResult } from './job.types.js';

/** Au plus un mois d'occurrences manquées est rattrapé (serveur arrêté, modèle ancien). */
const CATCH_UP_DAYS = 31;
const MAX_PER_TEMPLATE = 12;
const MAX_STEPS = 10_000;

interface TemplateRow {
  id: string;
  recurrence: ExpenseRecurrence;
  expenseDate: string;
  /** Jour (local) de création du modèle : jamais d'occurrence antérieure. */
  createdOn: string;
  lastGenerated: string | null;
}

interface Created {
  id: string;
  title: string;
  expenseDate: string;
}

@Injectable()
export class RecurringExpensesJob implements CompanyJob {
  readonly name = 'recurring-expenses';
  readonly scope = 'company' as const;
  readonly description =
    "Génère les dépenses récurrentes arrivées à échéance (en attente, liées à la dépense modèle) et prévient les managers.";

  private readonly logger = new Logger(RecurringExpensesJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async run(ctx: CompanyJobContext): Promise<JobResult> {
    // Un modèle annulé ou repassé à « non récurrent » n'est plus traité
    const templates: TemplateRow[] = await this.dataSource.query(
      `SELECT e.id,
              e.recurrence::text AS recurrence,
              to_char(e.expense_date, 'YYYY-MM-DD') AS "expenseDate",
              (e.created_at AT TIME ZONE $2::text)::date::text AS "createdOn",
              (SELECT to_char(MAX(c.expense_date), 'YYYY-MM-DD')
                 FROM expenses c
                WHERE c.company_id = e.company_id AND c.parent_expense_id = e.id) AS "lastGenerated"
         FROM expenses e
        WHERE e.company_id = $1
          AND e.is_recurring = true
          AND e.status <> 'cancelled'
          AND e.recurrence IS NOT NULL
        ORDER BY e.created_at ASC, e.id ASC`,
      [ctx.companyId, ctx.timeZone],
    );

    let generated = 0;
    let failed = 0;

    for (const template of templates) {
      const dates = this.missingDates(template, ctx.today);
      if (dates.length === 0) continue;

      try {
        const created = await this.dataSource.transaction((manager) =>
          this.generate(manager, ctx, template, dates),
        );
        generated += created.length;
        if (created.length > 0) await this.notify(ctx, created);
      } catch (error) {
        failed += 1;
        this.logger.error(`Génération impossible pour le modèle ${template.id}`, error as Error);
      }
    }

    // Relancer est sans danger : l'index unique (modèle, date) empêche tout doublon
    if (failed > 0) throw new Error(`${failed} modèle(s) n'ont pas pu être traités.`);
    return { templates: templates.length, generated };
  }

  /** Dates à générer : échues, jamais avant la création du modèle, au plus 31 jours en arrière. */
  private missingDates(template: TemplateRow, today: string): string[] {
    const earliest = maxDate(template.createdOn, addDays(today, -CATCH_UP_DAYS));
    const dates: string[] = [];

    for (let k = 1; k <= MAX_STEPS; k++) {
      const date = occurrenceDate(template.expenseDate, template.recurrence, k);
      if (date > today) break;
      if (date < earliest) continue;
      if (template.lastGenerated !== null && date <= template.lastGenerated) continue;
      dates.push(date);
      if (dates.length >= MAX_PER_TEMPLATE) break;
    }
    return dates;
  }

  private async generate(
    manager: EntityManager,
    ctx: CompanyJobContext,
    template: TemplateRow,
    dates: readonly string[],
  ): Promise<Created[]> {
    const created: Created[] = [];

    for (const date of dates) {
      const rows: Array<{ id: string; title: string; expenseDate: string }> = await manager.query(
        `INSERT INTO expenses
           (company_id, category_id, project_id, user_id, title, supplier_name,
            amount_ht, vat_amount, amount_ttc, status, is_recurring, recurrence,
            parent_expense_id, expense_date, due_date, validated_by, validated_at)
         SELECT t.company_id, t.category_id, t.project_id, t.user_id, t.title, t.supplier_name,
                t.amount_ht, t.vat_amount, t.amount_ttc,
                'pending'::expense_status, false, NULL::expense_recurrence,
                t.id, $3::date,
                CASE WHEN t.due_date IS NULL THEN NULL ELSE $3::date + (t.due_date - t.expense_date) END,
                CASE WHEN t.validated_at IS NULL THEN NULL ELSE t.validated_by END,
                CASE WHEN t.validated_at IS NULL THEN NULL ELSE now() END
           FROM expenses t
          WHERE t.company_id = $1 AND t.id = $2
         ON CONFLICT (parent_expense_id, expense_date) WHERE parent_expense_id IS NOT NULL DO NOTHING
         RETURNING id, title, to_char(expense_date, 'YYYY-MM-DD') AS "expenseDate"`,
        [ctx.companyId, template.id, date],
      );
      const row = rows[0];
      if (!row) continue; // déjà générée (autre instance, relance)

      // Les lignes sont copiées : le total HT doit rester égal à leur somme
      await manager.query(
        `INSERT INTO expense_items (expense_id, position, description, quantity, unit_price)
         SELECT $3::uuid, it.position, it.description, it.quantity, it.unit_price
           FROM expense_items it
           JOIN expenses t ON t.id = it.expense_id
          WHERE t.company_id = $1 AND it.expense_id = $2`,
        [ctx.companyId, template.id, row.id],
      );

      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.EXPENSE,
          entityId: row.id,
          companyId: ctx.companyId,
          userId: null, // génération automatique
          changes: {
            after: {
              title: row.title,
              expense_date: row.expenseDate,
              generated_from: template.id,
              automatic: true,
            },
          },
        },
        manager,
      );
      created.push(row);
    }
    return created;
  }

  private async notify(ctx: CompanyJobContext, created: readonly Created[]): Promise<void> {
    const newest = created[created.length - 1];
    await this.notifications.notify({
      companyId: ctx.companyId,
      recipientIds: await this.notifications.managerIds(ctx.companyId),
      ...notificationTemplates.expenseRecurrenceGenerated(
        { id: newest.id, title: newest.title },
        created.map((item) => item.expenseDate),
      ),
    });
  }
}