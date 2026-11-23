import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type {
  CreateLeaveRequestDto,
  LeaveCalendarQueryDto,
  LeaveListQueryDto,
} from '../../dto/hr/leave.dto.js';
import type { DecideRequestDto } from '../../dto/hr/decide-request.dto.js';
import type { LeaveRequest } from '../../entities/leave-request.entity.js';
import type { LeaveType } from '../../entities/leave-type.entity.js';
import { RequestStatus } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  AccessDeniedException,
  BusinessRuleException,
  ErrorCode,
  InvalidReferenceException,
} from '../../exceptions/index.js';
import { toBalanceLine, toLeaveRequest, toPerson } from '../../mapper/hr.mapper.js';
import { LeaveTypeRepository } from '../../repository/config-lists.repositories.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { LeaveBalanceRepository } from '../../repository/leave-balance.repository.js';
import { LeaveRequestRepository } from '../../repository/leave-request.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges } from '../audit/audit-changes.js';
import { LEAVE_REQUEST_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { formatDate } from '../invoices/pdf/pdf-format.js';
import { notificationTemplates } from '../notifications/notification-templates.js';
import { NotificationService } from '../notifications/notification.service.js';
import { monthRange, todayIn, weekRange } from '../projects/project-dates.js';
import { viewerOf } from '../tasks/task-rules.js';
import { LeaveBalanceService } from './leave-balance.service.js';
import {
  eachDay,
  isWorkingDay,
  leaveHalfDaysByYear,
  slotEnd,
  slotStart,
  spanDays,
  sumHalves,
} from './leave-calendar.js';
import type { LeaveSpan } from './leave-calendar.js';
import { assertCanDecide, planCancellation } from './request-workflow.js';

const { PENDING, APPROVED, REJECTED, CANCELLED } = RequestStatus;

const MIN_DATE = '2000-01-01';
const MAX_DATE = '2100-12-31';
const MAX_SPAN_DAYS = 366;

interface BuiltSpan extends LeaveSpan {
  halves: Map<number, number>;
  totalHalves: number;
}

const spanOf = (request: LeaveRequest): LeaveSpan => ({
  startDate: request.startDate,
  endDate: request.endDate,
  startHalfDay: request.startHalfDay,
  endHalfDay: request.endHalfDay,
});

@Injectable()
export class LeaveRequestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly requests: LeaveRequestRepository,
    private readonly balances: LeaveBalanceRepository,
    private readonly balanceService: LeaveBalanceService,
    private readonly leaveTypes: LeaveTypeRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------- Lectures ----------

  async list(viewer: AuthenticatedUser, query: LeaveListQueryDto) {
    const ctx = viewerOf(viewer);
    if (!ctx.privileged && query.user_id !== undefined && query.user_id !== viewer.id) {
      throw new AccessDeniedException(
        'Le filtre user_id est réservé aux administrateurs et managers.',
      );
    }

    const result = await this.requests.list(viewer.companyId, query, ctx, {
      statuses: query.status,
      userId: query.user_id,
      leaveTypeId: query.leave_type_id,
      from: query.from,
      to: query.to,
    });
    return result.map(toLeaveRequest);
  }

  /**
   * Fiche : solde du demandeur pour ce type et, pour un manager ou un admin, les absences
   * approuvées des autres qui chevauchent la période (avertissement au valideur).
   */
  async get(viewer: AuthenticatedUser, id: string) {
    const { companyId } = viewer;
    const ctx = viewerOf(viewer);
    const request = await this.requests.getDetailed(companyId, id, ctx); // 404 si invisible

    const year = Number(request.startDate.slice(0, 4));
    const [lines, overlaps] = await Promise.all([
      this.balanceService.summary(companyId, request.userId, year),
      ctx.privileged ? this.requests.teamOverlaps(companyId, { ...spanOf(request), userId: request.userId }) : [],
    ]);
    const line = lines.find((item) => item.leaveTypeId === request.leaveTypeId);
    const requesterTitle = request.user?.jobTitle ?? null;

    return {
      ...toLeaveRequest(request),
      balance: line && line.allowance !== null ? toBalanceLine(line) : null,
      ...(ctx.privileged
        ? {
            team_overlaps: overlaps.map((other) => ({
              request_id: other.id,
              user: toPerson(other.user),
              leave_type: { id: other.leaveType.id, name: other.leaveType.name },
              start_date: other.startDate,
              end_date: other.endDate,
              days_count: other.daysCount,
              same_job_title: requesterTitle !== null && other.user.jobTitle === requesterTitle,
            })),
          }
        : {}),
    };
  }

  /**
   * Qui est absent quand (congés approuvés), par mois ou par semaine. Les jours où deux
   * personnes du même poste sont absentes ressortent dans `conflicts`. Un collaborateur ne
   * voit pas le type de congé.
   */
  async calendar(viewer: AuthenticatedUser, query: LeaveCalendarQueryDto) {
    const { companyId } = viewer;
    const privileged = viewerOf(viewer).privileged;
    const today = todayIn((await this.companies.getById(companyId)).timezone);

    const view = query.view ?? 'month';
    const anchor = query.date ?? today;
    const range = view === 'week' ? weekRange(anchor) : monthRange(anchor);

    const approved = await this.requests.approvedOverlapping(companyId, range.from, range.to);

    const absences = approved.map((request) => ({
      request_id: request.id,
      user: toPerson(request.user),
      ...(privileged
        ? { leave_type: { id: request.leaveType.id, name: request.leaveType.name } }
        : {}),
      start_date: request.startDate,
      end_date: request.endDate,
      start_half_day: request.startHalfDay,
      end_half_day: request.endHalfDay,
      days_count: request.daysCount,
    }));

    const days = eachDay(range.from, range.to).map((date) => {
      const working = isWorkingDay(date);
      const absent = working
        ? approved
            .filter((request) => request.startDate <= date && date <= request.endDate)
            .map((request) => ({
              user_id: request.userId,
              job_title: request.user.jobTitle,
              fraction:
                (date === request.startDate && request.startHalfDay) ||
                (date === request.endDate && request.endHalfDay)
                  ? 0.5
                  : 1,
            }))
        : [];
      return { date, is_working_day: working, absent };
    });

    const conflicts = days.flatMap((day) => {
      const byTitle = new Map<string, string[]>();
      for (const entry of day.absent) {
        if (!entry.job_title) continue;
        byTitle.set(entry.job_title, [...(byTitle.get(entry.job_title) ?? []), entry.user_id]);
      }
      return [...byTitle.entries()]
        .filter(([, userIds]) => userIds.length >= 2)
        .map(([jobTitle, userIds]) => ({ date: day.date, job_title: jobTitle, user_ids: userIds }));
    });

    return {
      view,
      from: range.from,
      to: range.to,
      absences,
      days: days.map((day) => ({
        date: day.date,
        is_working_day: day.is_working_day,
        absent_count: day.absent.length,
        absent: day.absent.map(({ user_id, fraction }) => ({ user_id, fraction })),
      })),
      conflicts,
    };
  }

  // ---------- Création ----------

  /**
   * Refus (422) en cas de chevauchement avec une demande en attente ou approuvée de la même
   * personne, de période sans jour ouvré, ou de solde insuffisant.
   */
  async create(user: AuthenticatedUser, dto: CreateLeaveRequestDto) {
    const { companyId } = user;
    const span = this.buildSpan(dto);

    const leaveType = await this.leaveTypes.findById(companyId, dto.leave_type_id);
    if (!leaveType) throw new InvalidReferenceException('leave_type_id', 'Type de congé');

    const id = await this.dataSource.transaction(async (manager) => {
      const repo = this.requests.withManager(manager);
      await repo.lockUser(companyId, user.id);

      const overlap = await repo.findOverlap(companyId, user.id, span);
      if (overlap) {
        throw new BusinessRuleException(
          `Cette période chevauche une demande ${overlap.status === APPROVED ? 'approuvée' : 'en attente'} du ${formatDate(overlap.startDate)} au ${formatDate(overlap.endDate)}.`,
          ErrorCode.LEAVE_OVERLAP,
          { conflicting_request_id: overlap.id },
        );
      }

      await this.assertBalance(manager, companyId, user.id, leaveType, span, [PENDING, APPROVED], null);

      const created = await repo.insertRequest(companyId, {
        userId: user.id,
        leaveTypeId: leaveType.id,
        startDate: span.startDate,
        endDate: span.endDate,
        startHalfDay: span.startHalfDay,
        endHalfDay: span.endHalfDay,
        daysCount: span.totalHalves / 2,
        reason: dto.reason ?? null,
        status: PENDING,
      });
      return created.id;
    });

    await this.notifications.notifyManagers({
      companyId,
      actorId: user.id,
      ...notificationTemplates.leaveRequestCreated(
        { id },
        user.name,
        span.startDate,
        span.endDate,
      ),
    });
    return this.get(user, id);
  }

  // ---------- Décisions ----------

  approve(user: AuthenticatedUser, id: string, dto: DecideRequestDto) {
    return this.decide(user, id, 'approved', dto);
  }

  reject(user: AuthenticatedUser, id: string, dto: DecideRequestDto) {
    return this.decide(user, id, 'rejected', dto);
  }

  /**
   * Annulation : le demandeur tant que la demande est en attente ; un manager ou un admin pour
   * une demande approuvée (les jours sont alors restitués au solde). Idempotent.
   */
  async cancel(viewer: AuthenticatedUser, id: string, dto: DecideRequestDto) {
    const { companyId } = viewer;
    const ctx = viewerOf(viewer);
    const visible = await this.requests.getDetailed(companyId, id, ctx); // 404 si invisible

    const outcome = await this.dataSource.transaction(async (manager) => {
      const repo = this.requests.withManager(manager);
      await repo.lockUser(companyId, visible.userId);
      const before = await repo.lockById(companyId, id);

      const plan = planCancellation(before, ctx);
      if (plan === 'noop') return { request: before, changed: false };

      const changes: Record<string, unknown> = { status: CANCELLED };
      if (plan === 'by_manager') {
        // Le manager devient le valideur enregistré ; l'approbation d'origine reste dans l'audit
        changes.reviewedById = viewer.id;
        changes.reviewedAt = new Date();
        if (dto.comment !== undefined) changes.reviewComment = dto.comment;
      }

      const after = await repo.changeRequest(companyId, id, changes);
      await this.audit.record(
        {
          action: AuditAction.CANCEL,
          entityType: AuditEntityType.LEAVE_REQUEST,
          entityId: id,
          companyId,
          userId: viewer.id,
          changes: diffChanges(before, after, LEAVE_REQUEST_AUDIT_FIELDS),
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
        ...notificationTemplates.leaveRequestDecided(outcome.request, 'cancelled', dto.comment),
      });
    }
    return this.get(viewer, id);
  }

  // ---------- Outils internes ----------

  private async decide(
    user: AuthenticatedUser,
    id: string,
    decision: 'approved' | 'rejected',
    dto: DecideRequestDto,
  ) {
    const { companyId } = user;
    const known = await this.requests.getById(companyId, id); // 404

    const after = await this.dataSource.transaction(async (manager) => {
      const repo = this.requests.withManager(manager);
      await repo.lockUser(companyId, known.userId);
      const before = await repo.lockById(companyId, id);
      assertCanDecide(before, user.id); // 403 si c'est sa propre demande, 409 si déjà traitée

      if (decision === 'approved') {
        // Le solde peut avoir changé depuis la demande : contrôle à nouveau (jours approuvés seulement,
        // car les jours en attente ont déjà été réservés à la création)
        const leaveType = await this.leaveTypes
          .withManager(manager)
          .findById(companyId, before.leaveTypeId);
        if (leaveType) {
          await this.assertBalance(
            manager,
            companyId,
            before.userId,
            leaveType,
            this.builtSpanOf(before),
            [APPROVED],
            before.id,
          );
        }
      }

      const updated = await repo.changeRequest(companyId, id, {
        status: decision === 'approved' ? APPROVED : REJECTED,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewComment: dto.comment ?? null,
      });
      await this.audit.record(
        {
          action: decision === 'approved' ? AuditAction.APPROVE : AuditAction.REJECT,
          entityType: AuditEntityType.LEAVE_REQUEST,
          entityId: id,
          companyId,
          userId: user.id,
          changes: diffChanges(before, updated, LEAVE_REQUEST_AUDIT_FIELDS),
        },
        manager,
      );
      return updated;
    });

    await this.notifications.notify({
      companyId,
      recipientIds: [after.userId],
      actorId: user.id,
      ...notificationTemplates.leaveRequestDecided(after, decision, dto.comment),
    });
    return this.get(user, id);
  }

  /** Dates valides, jours ouvrés décomptés par année. */
  private buildSpan(dto: CreateLeaveRequestDto): BuiltSpan {
    const span: LeaveSpan = {
      startDate: dto.start_date,
      endDate: dto.end_date,
      startHalfDay: dto.start_half_day ?? false,
      endHalfDay: dto.end_half_day ?? false,
    };

    if (span.endDate < span.startDate) {
      throw new BusinessRuleException('La date de fin ne peut pas précéder la date de début.');
    }
    if (span.startDate < MIN_DATE || span.endDate > MAX_DATE) {
      throw new BusinessRuleException('Les dates doivent être comprises entre 2000 et 2100.');
    }
    if (spanDays(span.startDate, span.endDate) > MAX_SPAN_DAYS) {
      throw new BusinessRuleException(
        `Une demande ne peut pas dépasser ${MAX_SPAN_DAYS} jours : scindez-la en plusieurs demandes.`,
      );
    }
    if (
      slotStart(span.startDate, span.startHalfDay) > slotEnd(span.endDate, span.endHalfDay)
    ) {
      throw new BusinessRuleException(
        "Un même jour ne peut pas commencer l'après-midi et se terminer le matin.",
      );
    }

    return this.withHalves(span);
  }

  private builtSpanOf(request: LeaveRequest): BuiltSpan {
    return this.withHalves(spanOf(request));
  }

  private withHalves(span: LeaveSpan): BuiltSpan {
    const halves = leaveHalfDaysByYear(span);
    const totalHalves = sumHalves(halves);
    if (totalHalves <= 0) {
      throw new BusinessRuleException(
        'Cette période ne contient aucun jour ouvré à décompter (week-ends exclus).',
        ErrorCode.NO_WORKING_DAYS,
      );
    }
    return { ...span, halves, totalHalves };
  }

  /**
   * Types avec quota : pour chaque année concernée, les jours déjà engagés (statuts donnés) plus
   * ceux de cette demande ne doivent pas dépasser le quota de la personne (422 sinon).
   */
  private async assertBalance(
    manager: EntityManager,
    companyId: string,
    userId: string,
    leaveType: LeaveType,
    span: BuiltSpan,
    statuses: readonly RequestStatus[],
    excludeId: string | null,
  ): Promise<void> {
    const quota = leaveType.defaultAnnualDays;
    if (quota === null) return; // pas de quota : jamais bloqué

    const requests = this.requests.withManager(manager);
    const balances = this.balances.withManager(manager);

    for (const [year, requestedHalves] of span.halves) {
      const allowance = await balances.ensureAllowance(companyId, userId, leaveType.id, year, quota);
      const others = await requests.spansOfType(
        companyId,
        userId,
        leaveType.id,
        year,
        statuses,
        excludeId,
      );
      const committedHalves = others.reduce(
        (sum, other) => sum + (leaveHalfDaysByYear(other).get(year) ?? 0),
        0,
      );

      // Comparaison en dixièmes de jour : le quota a une décimale, les demandes des demi-journées
      const allowanceTenths = Math.round(allowance * 10);
      if ((committedHalves + requestedHalves) * 5 > allowanceTenths) {
        const available = Math.max(0, allowanceTenths - committedHalves * 5) / 10;
        throw new BusinessRuleException(
          `Solde insuffisant pour « ${leaveType.name} » en ${year} : ${requestedHalves / 2} jour(s) demandé(s), ${available} disponible(s).`,
          ErrorCode.INSUFFICIENT_LEAVE_BALANCE,
          {
            year,
            allowance_days: allowance,
            committed_days: committedHalves / 2,
            requested_days: requestedHalves / 2,
            available_days: available,
          },
        );
      }
    }
  }
}