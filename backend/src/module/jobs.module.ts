import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsController } from '../controller/jobs/jobs.controller.js';
import { ScheduledJobRun } from '../entities/scheduled-job-run.entity.js';
import { ApprovalRemindersJob } from '../jobs/approval-reminders.job.js';
import { DueRemindersJob } from '../jobs/due-reminders.job.js';
import { JobAdminService } from '../jobs/job-admin.service.js';
import { JobRegistry } from '../jobs/job-registry.js';
import { JobRunner } from '../jobs/job-runner.js';
import { JobScheduler } from '../jobs/job-scheduler.js';
import { JobsConfig } from '../jobs/jobs-config.js';
import { OverdueInvoicesJob } from '../jobs/overdue-invoices.job.js';
import { PurgeAuditLogsJob } from '../jobs/purge-audit-logs.job.js';
import { PurgeExpiredJob } from '../jobs/purge-expired.job.js';
import { PurgeNotificationsJob } from '../jobs/purge-notifications.job.js';
import { PurgeOrphanFilesJob } from '../jobs/purge-orphan-files.job.js';
import { PurgeTrashJob } from '../jobs/purge-trash.job.js';
import { RecurringExpensesJob } from '../jobs/recurring-expenses.job.js';
import { JobRunRepository } from '../repository/job-run.repository.js';
import { CompanyModule } from './company.module.js';
import { FilesModule } from './files.module.js';

// AuditService et NotificationService viennent de modules globaux
@Module({
  imports: [TypeOrmModule.forFeature([ScheduledJobRun]), CompanyModule, FilesModule],
  controllers: [JobsController],
  providers: [
    JobsConfig,
    JobRunRepository,
    JobRunner,
    JobScheduler,
    JobRegistry,
    JobAdminService,
    OverdueInvoicesJob,
    RecurringExpensesJob,
    DueRemindersJob,
    ApprovalRemindersJob,
    PurgeNotificationsJob,
    PurgeTrashJob,
    PurgeOrphanFilesJob,
    PurgeAuditLogsJob,
    PurgeExpiredJob,
  ],
})
export class JobsModule {}