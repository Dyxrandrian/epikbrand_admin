import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DecideRequestDto } from '../../dto/hr/decide-request.dto.js';
import type {
  CreateTrainingRequestDto,
  TrainingListQueryDto,
  TrainingSummaryQueryDto,
} from '../../dto/hr/training.dto.js';
import { RequestStatus } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { AccessDeniedException } from '../../exceptions/index.js';
import { toPerson, toTrainingRequest } from '../../mapper/hr.mapper.js';
import type { PersonFields } from '../../mapper/hr.mapper.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { TrainingRequestRepository } from '../../repository/training-request.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges } from '../audit/audit-changes.js';
import { TRAINING_REQUEST_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { notificationTemplates } from '../notifications/notification-templates.js';
import { NotificationService } from '../notifications/notification.service.js';
import { viewerOf } from '../tasks/task-rules.js';
import { assertCanDecide, planCancellation } from './request-workflow.js';

const { PENDING, APPROVED, REJECTED, CANCELLED } = RequestStatus;

@Injectable()
export class TrainingRequestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly requests: TrainingRequestRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async list(viewer: AuthenticatedUser, query: TrainingListQueryDto) {
    const ctx = viewerOf(viewer);
    if (!ctx.privileged && query.user_id !== undefined && query.user_id !== viewer.id) {
      throw new AccessDeniedException(
        'Le filtre user_id est réservé aux administrateurs et managers.',
      );
    }

    const timeZone = (await this.companies.getById(viewer.companyId)).timezone;
    const result = await this.requests.list(viewer.companyId, query, ctx, {
      statuses: query.status,
      userId: query.user_id,
      from: query.from,
      to: query.to,
      timeZone,
    });
    return result.map(toTrainingRequest);
  }

  /** 404 si la demande n'est pas visible par ce lecteur (un collaborateur : la sienne seulement). */
  async get(viewer: AuthenticatedUser, id: string) {
    return toTrainingRequest(
      await this.requests.getDetailed(viewer.companyId, id, viewerOf(viewer)),
    );
  }

  async create(user: AuthenticatedUser, dto: CreateTrainingRequestDto) {
    const { companyId } = user;

    const created = await this.requests.insertRequest(companyId, {
      userId: user.id,
      trainingName: dto.training_name,
      description: dto.description ?? null,
      status: PENDING,
    });

    await this.notifications.notifyManagers({
      companyId,
      actorId: user.id,
      ...notificationTemplates.trainingRequestCreated(
        { id: created.id, trainingName: created.trainingName },
        user.name,
      ),
    });
    return this.get(user, created.id);
  }

  approve(user: AuthenticatedUser, id: string, dto: DecideRequestDto) {
    return this.decide(user, id, 'approved', dto);
  }

  reject(user: AuthenticatedUser, id: string, dto: DecideRequestDto) {
    return this.decide(user, id, 'rejected', dto);
  }

  /** Mêmes règles que les congés : le demandeur en attente, un manager ou un admin si approuvée. */
  async cancel(viewer: AuthenticatedUser, id: string, dto: DecideRequestDto) {
    const { companyId } = viewer;
    const ctx = viewerOf(viewer);
    await this.requests.getDetailed(companyId, id, ctx); // 404 si invisible

    const outcome = await this.dataSource.transaction(async (manager) => {
      const repo = this.requests.withManager(manager);
      const before = await repo.lockById(companyId, id);

      const plan = planCancellation(before, ctx);
      if (plan === 'noop') return { request: before, changed: false };

      const changes: Record<string, unknown> = { status: CANCELLED };
      if (plan === 'by_manager') {
        changes.reviewedById = viewer.id;
        changes.reviewedAt = new Date();
        if (dto.comment !== undefined) changes.reviewComment = dto.comment;
      }

      const after = await repo.changeRequest(companyId, id, changes);
      await this.audit.record(
        {
          action: AuditAction.CANCEL,
          entityType: AuditEntityType.TRAINING_REQUEST,
          entityId: id,
          companyId,
          userId: viewer.id,
          changes: diffChanges(before, after, TRAINING_REQUEST_AUDIT_FIELDS),
        },
        manager,
      );
      return { request: after, changed: true };
    });

    if (outcome.changed && outcome.request.userId !== viewer.id) {
      await this.notifications.notify({
        companyId,
        recipientIds: [outcome.request.userId],
        actorId: viewer.id,
        ...notificationTemplates.trainingRequestDecided(outcome.request, 'cancelled', dto.comment),
      });
    }
    return this.get(viewer, id);
  }

  /** Formations approuvées par personne, pour une période de la date de décision. */
  async summary(viewer: AuthenticatedUser, query: TrainingSummaryQueryDto) {
    const timeZone = (await this.companies.getById(viewer.companyId)).timezone;
    const approved = await this.requests.approvedInPeriod(viewer.companyId, {
      from: query.from,
      to: query.to,
      timeZone,
    });

    const byPerson = new Map<
      string,
      { user: PersonFields; trainings: Array<{ id: string; training_name: string; approved_at: Date | null }> }
    >();
    for (const request of approved) {
      const entry = byPerson.get(request.userId) ?? { user: request.user, trainings: [] };
      entry.trainings.push({
        id: request.id,
        training_name: request.trainingName,
        approved_at: request.reviewedAt,
      });
      byPerson.set(request.userId, entry);
    }

    const people = [...byPerson.values()]
      .map((entry) => ({
        user: toPerson(entry.user),
        count: entry.trainings.length,
        trainings: entry.trainings,
      }))
      .sort((a, b) => b.count - a.count || a.user.name.localeCompare(b.user.name, 'fr'));

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      total: approved.length,
      people,
    };
  }

  // ---------- Outils internes ----------

  private async decide(
    user: AuthenticatedUser,
    id: string,
    decision: 'approved' | 'rejected',
    dto: DecideRequestDto,
  ) {
    const { companyId } = user;
    await this.requests.getById(companyId, id); // 404

    const after = await this.dataSource.transaction(async (manager) => {
      const repo = this.requests.withManager(manager);
      const before = await repo.lockById(companyId, id);
      assertCanDecide(before, user.id); // 403 si c'est sa propre demande, 409 si déjà traitée

      const updated = await repo.changeRequest(companyId, id, {
        status: decision === 'approved' ? APPROVED : REJECTED,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewComment: dto.comment ?? null,
      });
      await this.audit.record(
        {
          action: decision === 'approved' ? AuditAction.APPROVE : AuditAction.REJECT,
          entityType: AuditEntityType.TRAINING_REQUEST,
          entityId: id,
          companyId,
          userId: user.id,
          changes: diffChanges(before, updated, TRAINING_REQUEST_AUDIT_FIELDS),
        },
        manager,
      );
      return updated;
    });

    await this.notifications.notify({
      companyId,
      recipientIds: [after.userId],
      actorId: user.id,
      ...notificationTemplates.trainingRequestDecided(after, decision, dto.comment),
    });
    return this.get(user, id);
  }
}