import { Injectable } from '@nestjs/common';
import { ApprovalRemindersJob } from './approval-reminders.job.js';
import { DueRemindersJob } from './due-reminders.job.js';
import { OverdueInvoicesJob } from './overdue-invoices.job.js';
import { PurgeAuditLogsJob } from './purge-audit-logs.job.js';
import { PurgeExpiredJob } from './purge-expired.job.js';
import { PurgeNotificationsJob } from './purge-notifications.job.js';
import { PurgeOrphanFilesJob } from './purge-orphan-files.job.js';
import { PurgeTrashJob } from './purge-trash.job.js';
import { RecurringExpensesJob } from './recurring-expenses.job.js';
import type { CompanyJob, GlobalJob, ScheduledJob } from './job.types.js';

@Injectable()
export class JobRegistry {
  /** L'ordre est celui d'exécution : génération et bascules d'abord, purges ensuite. */
  private readonly jobs: ScheduledJob[];

  constructor(
    overdueInvoices: OverdueInvoicesJob,
    recurringExpenses: RecurringExpensesJob,
    dueReminders: DueRemindersJob,
    approvalReminders: ApprovalRemindersJob,
    purgeNotifications: PurgeNotificationsJob,
    purgeTrash: PurgeTrashJob,
    purgeOrphanFiles: PurgeOrphanFilesJob,
    purgeAuditLogs: PurgeAuditLogsJob,
    purgeExpired: PurgeExpiredJob,
  ) {
    this.jobs = [
      overdueInvoices,
      recurringExpenses,
      dueReminders,
      approvalReminders,
      purgeNotifications,
      purgeTrash,
      purgeOrphanFiles,
      purgeAuditLogs,
      purgeExpired,
    ];
  }

  company(): CompanyJob[] {
    return this.jobs.filter((job): job is CompanyJob => job.scope === 'company');
  }

  global(): GlobalJob[] {
    return this.jobs.filter((job): job is GlobalJob => job.scope === 'global');
  }

  findCompany(name: string): CompanyJob | undefined {
    return this.company().find((job) => job.name === name);
  }
}