import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditAction, AuditEntityType } from '../enums/audit.enums.js';
import { AuditService } from '../services/audit/audit.service.js';
import { notificationTemplates } from '../services/notifications/notification-templates.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import { MAX_INDIVIDUAL_NOTIFICATIONS, moneyText, notifyUpTo } from './job-helpers.js';
import type { CompanyJob, CompanyJobContext, JobResult } from './job.types.js';

interface OverdueRow {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  clientName: string;
  currency: string;
  balance: string;
}

@Injectable()
export class OverdueInvoicesJob implements CompanyJob {
  readonly name = 'overdue-invoices';
  readonly scope = 'company' as const;
  readonly description =
    "Passe en « en retard » les factures envoyées dont l'échéance est dépassée et le solde non nul, puis prévient les managers.";

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async run(ctx: CompanyJobContext): Promise<JobResult> {
    const rows = await this.dataSource.transaction(async (manager) => {
      // version + 1 : un éditeur qui a ouvert la facture avant la bascule recevra un 409
      const flipped: OverdueRow[] = await manager.query(
        `WITH changed AS (
           UPDATE invoices
              SET status = 'overdue', version = version + 1, updated_at = now()
            WHERE company_id = $1
              AND type = 'invoice'
              AND status = 'sent'
              AND due_date IS NOT NULL
              AND due_date < $2::date
              AND total_ttc - amount_paid - credited_total > 0
        RETURNING id, invoice_number, due_date, client_id, currency, total_ttc, amount_paid, credited_total)
         SELECT c.id,
                c.invoice_number AS "invoiceNumber",
                to_char(c.due_date, 'YYYY-MM-DD') AS "dueDate",
                cl.company_name AS "clientName",
                c.currency,
                (c.total_ttc - c.amount_paid - c.credited_total)::text AS balance
           FROM changed c
           JOIN clients cl ON cl.id = c.client_id AND cl.company_id = $1
          ORDER BY c.due_date ASC, c.id ASC`,
        [ctx.companyId, ctx.today],
      );

      for (const row of flipped) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.INVOICE,
            entityId: row.id,
            companyId: ctx.companyId,
            userId: null, // changement automatique
            changes: {
              before: { status: 'sent' },
              after: { status: 'overdue', invoice_number: row.invoiceNumber, automatic: true },
            },
          },
          manager,
        );
      }
      return flipped;
    });

    if (rows.length > 0) {
      const managers = await this.notifications.managerIds(ctx.companyId);
      await notifyUpTo(
        rows,
        MAX_INDIVIDUAL_NOTIFICATIONS,
        (row) =>
          this.notifications.notify({
            companyId: ctx.companyId,
            recipientIds: managers,
            ...notificationTemplates.invoiceOverdue({
              id: row.id,
              number: row.invoiceNumber,
              clientName: row.clientName,
              dueDate: row.dueDate,
              balance: moneyText(row.balance, row.currency),
            }),
          }),
        (remaining) =>
          this.notifications.notify({
            companyId: ctx.companyId,
            recipientIds: managers,
            ...notificationTemplates.invoicesOverdue(remaining),
          }),
      );
    }
    return { overdue: rows.length };
  }
}