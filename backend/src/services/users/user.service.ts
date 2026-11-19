import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { InviteUserDto } from '../../dto/auth/invite-user.dto.js';
import { mapDto } from '../../dto/map-dto.js';
import type { UpdateUserDto } from '../../dto/users/update-user.dto.js';
import type { UserListQueryDto } from '../../dto/users/user-list-query.dto.js';
import { RefreshToken } from '../../entities/refresh-token.entity.js';
import type { User } from '../../entities/user.entity.js';
import { UserRole } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  AccessDeniedException,
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
  ResourceNotFoundException,
} from '../../exceptions/index.js';
import {
  toDirectoryGroups,
  toUserDetail,
  toUserView,
} from '../../mapper/user.mapper.js';
import { UserRepository } from '../../repository/user.repository.js';
import type { UpdateChanges } from '../../repository/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { USER_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { InvitationService } from '../auth/invitation.service.js';

const UPDATE_MAP = {
  role: 'role',
  job_title: 'jobTitle',
  matricule: 'matricule',
  is_active: 'isActive',
} as const;

@Injectable()
export class UserService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
    private readonly invitations: InvitationService,
  ) {}

  async list(viewer: AuthenticatedUser, query: UserListQueryDto) {
    const privileged = viewer.role !== UserRole.COLLABORATOR;

    if (!privileged && (query.role !== undefined || query.is_active !== undefined)) {
      throw new AccessDeniedException(
        'Les filtres role et is_active sont réservés aux administrateurs et managers.',
      );
    }

    const result = await this.users.list(viewer.companyId, query, { privileged });
    return result.map((user) => toUserView(user, viewer));
  }

  async directory(viewer: AuthenticatedUser) {
    return toDirectoryGroups(await this.users.directory(viewer.companyId));
  }

  async get(viewer: AuthenticatedUser, id: string) {
    const user = await this.users.getById(viewer.companyId, id);

    // Un collaborateur ne voit pas les comptes désactivés : 404, comme s'ils n'existaient pas
    if (viewer.role === UserRole.COLLABORATOR && viewer.id !== user.id && !user.isActive) {
      throw new ResourceNotFoundException('Utilisateur');
    }
    return toUserView(user, viewer);
  }

  /** Création = invitation (contrat section 5) : mêmes règles, même audit. */
  create(admin: AuthenticatedUser, dto: InviteUserDto) {
    return this.invitations.invite(admin, dto);
  }

  async update(admin: AuthenticatedUser, id: string, dto: UpdateUserDto) {
    const changes = mapDto(dto, UPDATE_MAP);

    return this.dataSource.transaction(async (manager) => {
      const users = this.users.withManager(manager);
      const before = await users.getById(admin.companyId, id);

      if (id === admin.id && dto.is_active === false) {
        throw new BusinessRuleException(
          'Vous ne pouvez pas désactiver votre propre compte.',
          ErrorCode.SELF_ACTION_FORBIDDEN,
        );
      }

      const demotes = dto.role !== undefined && dto.role !== UserRole.ADMIN;
      const deactivates = dto.is_active === false;
      if (before.role === UserRole.ADMIN && before.isActive && (demotes || deactivates)) {
        await this.assertAnotherActiveAdmin(users, admin.companyId, id);
      }

      if (Object.keys(changes).length === 0) return toUserDetail(before);

      const after = await users.updateById(admin.companyId, id, changes as UpdateChanges<User>);

      const diff = diffChanges(before, after, USER_AUDIT_FIELDS);
      if (diff) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.USER,
            entityId: id,
            companyId: admin.companyId,
            userId: admin.id,
            changes: diff,
          },
          manager,
        );
      }

      // Désactivation : les sessions de la personne sont coupées dans la même transaction
      if (before.isActive && !after.isActive) {
        await manager.update(RefreshToken, { userId: id, revokedAt: IsNull() }, { revokedAt: new Date() });
      }
      return toUserDetail(after);
    });
  }

  async remove(admin: AuthenticatedUser, id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const users = this.users.withManager(manager);
      const target = await users.getById(admin.companyId, id);

      if (id === admin.id) {
        throw new BusinessRuleException(
          'Vous ne pouvez pas supprimer votre propre compte.',
          ErrorCode.SELF_ACTION_FORBIDDEN,
        );
      }
      if (target.role === UserRole.ADMIN && target.isActive) {
        await this.assertAnotherActiveAdmin(users, admin.companyId, id);
      }
      if (await users.hasLinkedData(admin.companyId, id)) {
        throw new ConflictAppException(
          'Cet utilisateur a un historique (demandes, tâches, factures, journal…) : il ne peut pas être supprimé. Désactivez son compte à la place.',
          ErrorCode.REFERENCE_CONFLICT,
        );
      }

      const before = snapshot(target, USER_AUDIT_FIELDS);
      await users.deleteById(admin.companyId, id);

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entityType: AuditEntityType.USER,
          entityId: id,
          companyId: admin.companyId,
          userId: admin.id,
          changes: { before },
        },
        manager,
      );
    });
  }

  /** Garde-fou « dernier admin » : il doit rester un autre administrateur actif. */
  private async assertAnotherActiveAdmin(
    users: UserRepository,
    companyId: string,
    targetId: string,
  ): Promise<void> {
    const admins = await users.lockActiveAdmins(companyId);
    if (!admins.some((admin) => admin.id !== targetId)) {
      throw new BusinessRuleException(
        "Opération impossible : l'entreprise doit conserver au moins un administrateur actif.",
        ErrorCode.LAST_ADMIN,
      );
    }
  }
}