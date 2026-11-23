import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { LeaveBalanceQueryDto, SetLeaveBalanceDto } from '../../dto/hr/leave.dto.js';
import { RequestStatus } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  AccessDeniedException,
  BusinessRuleException,
  InvalidReferenceException,
} from '../../exceptions/index.js';
import { toBalanceLine } from '../../mapper/hr.mapper.js';
import type { BalanceLine } from '../../mapper/hr.mapper.js';
import { LeaveTypeRepository } from '../../repository/config-lists.repositories.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { LeaveBalanceRepository } from '../../repository/leave-balance.repository.js';
import { LeaveRequestRepository } from '../../repository/leave-request.repository.js';
import { isManagerOrAdmin } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { AuditService } from '../audit/audit.service.js';
import { todayIn } from '../projects/project-dates.js';
import { leaveHalfDaysByYear } from './leave-calendar.js';

const { APPROVED, PENDING } = RequestStatus;

@Injectable()
export class LeaveBalanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly balances: LeaveBalanceRepository,
    private readonly requests: LeaveRequestRepository,
    private readonly leaveTypes: LeaveTypeRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Situation d'une personne pour une année, par type de congé :
   * quota, jours approuvés, jours en attente, jours encore disponibles.
   * Rien n'est stocké : tout se calcule à partir des demandes.
   */
  async summary(companyId: string, userId: string, year: number): Promise<BalanceLine[]> {
    const [types, allowances, spans] = await Promise.all([
      this.balances.typesOf(companyId),
      this.balances.allowancesOf(companyId, userId, year),
      this.requests.spansOfUser(companyId, userId, year, [APPROVED, PENDING]),
    ]);

    return types.map((type) => {
      const own = spans.filter((span) => span.leaveTypeId === type.id);
      const halvesOf = (status: RequestStatus): number =>
        own
          .filter((span) => span.status === status)
          .reduce((sum, span) => sum + (leaveHalfDaysByYear(span).get(year) ?? 0), 0);

      const used = halvesOf(APPROVED) / 2;
      const pending = halvesOf(PENDING) / 2;
      const allowance =
        type.defaultAnnualDays === null ? null : (allowances.get(type.id) ?? type.defaultAnnualDays);

      return {
        leaveTypeId: type.id,
        leaveTypeName: type.name,
        year,
        allowance,
        used,
        pending,
        remaining: allowance === null ? null : Math.round((allowance - used - pending) * 10) / 10,
      };
    });
  }

  async list(viewer: AuthenticatedUser, query: LeaveBalanceQueryDto) {
    const { companyId } = viewer;
    const userId = query.user_id ?? viewer.id;

    if (userId !== viewer.id) {
      if (!isManagerOrAdmin(viewer)) {
        throw new AccessDeniedException(
          'Le filtre user_id est réservé aux administrateurs et managers.',
        );
      }
      await this.balances.assertUserInCompany(companyId, userId); // 404
    }

    const year = query.year ?? Number(todayIn((await this.companies.getById(companyId)).timezone).slice(0, 4));
    const lines = await this.summary(companyId, userId, year);
    return { user_id: userId, year, balances: lines.map(toBalanceLine) };
  }

  /** Fixe le quota annuel d'une personne (admin). Journalisé avec l'ancienne valeur. */
  async set(admin: AuthenticatedUser, dto: SetLeaveBalanceDto) {
    const { companyId } = admin;

    const type = await this.leaveTypes.findById(companyId, dto.leave_type_id);
    if (!type) throw new InvalidReferenceException('leave_type_id', 'Type de congé');
    if (type.defaultAnnualDays === null) {
      throw new BusinessRuleException(
        "Ce type de congé n'a pas de quota annuel : renseignez d'abord son quota par défaut.",
      );
    }
    await this.balances.assertActiveUser(companyId, dto.user_id, 'user_id');

    await this.dataSource.transaction(async (manager) => {
      await this.requests.withManager(manager).lockUser(companyId, dto.user_id);

      const { id, previous } = await this.balances
        .withManager(manager)
        .upsertAllowance(companyId, dto.user_id, dto.leave_type_id, dto.year, dto.allowance_days);

      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.LEAVE_BALANCE,
          entityId: id,
          companyId,
          userId: admin.id,
          changes: {
            before: { allowance_days: previous },
            after: {
              allowance_days: dto.allowance_days,
              user_id: dto.user_id,
              leave_type_id: dto.leave_type_id,
              year: dto.year,
            },
          },
        },
        manager,
      );
    });

    const lines = await this.summary(companyId, dto.user_id, dto.year);
    const line = lines.find((item) => item.leaveTypeId === dto.leave_type_id);
    return line ? toBalanceLine(line) : null;
  }
}