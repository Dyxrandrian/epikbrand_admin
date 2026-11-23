import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { notificationTemplates } from '../services/notifications/notification-templates.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import type { CompanyJob, CompanyJobContext, JobResult } from './job.types.js';

/** Rappel quand une demande attend depuis exactement ce nombre de jours (sans état à mémoriser). */
const REMINDER_AGES = [3, 7, 14, 21, 28];

@Injectable()
export class ApprovalRemindersJob implements CompanyJob {
  readonly name = 'approval-reminders';
  readonly scope = 'company' as const;
  readonly description =
    "Rappelle aux managers et administrateurs les demandes de congé et de formation en attente depuis 3, 7, 14, 21 et 28 jours.";

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationService,
  ) {}

  async run(ctx: CompanyJobContext): Promise<JobResult> {
    const rows: Array<{ leave: number; training: number }> = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM leave_requests
           WHERE company_id = $1 AND status = 'pending'
             AND ($2::date - (created_at AT TIME ZONE $3::text)::date) = ANY($4::int[])) AS leave,
         (SELECT COUNT(*)::int FROM training_requests
           WHERE company_id = $1 AND status = 'pending'
             AND ($2::date - (created_at AT TIME ZONE $3::text)::date) = ANY($4::int[])) AS training`,
      [ctx.companyId, ctx.today, ctx.timeZone, REMINDER_AGES],
    );
    const { leave, training } = rows[0];

    if (leave + training > 0) {
      const managers = await this.notifications.managerIds(ctx.companyId);
      if (leave > 0) {
        await this.notifications.notify({
          companyId: ctx.companyId,
          recipientIds: managers,
          ...notificationTemplates.approvalReminder('leave', leave),
        });
      }
      if (training > 0) {
        await this.notifications.notify({
          companyId: ctx.companyId,
          recipientIds: managers,
          ...notificationTemplates.approvalReminder('training', training),
        });
      }
    }
    return { leave_requests: leave, training_requests: training };
  }
}