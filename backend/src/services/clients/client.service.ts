import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  ClientListQueryDto,
  CreateClientDto,
  UpdateClientDto,
} from '../../dto/clients/index.js';
import { mapDto } from '../../dto/map-dto.js';
import type { Client } from '../../entities/client.entity.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  AccessDeniedException,
  ConflictAppException,
  ErrorCode,
  PotentialDuplicateException,
} from '../../exceptions/index.js';
import {
  toClient,
  toClientProject,
  toDuplicate,
  toInteraction,
} from '../../mapper/crm.mapper.js';
import type { UpdateChanges } from '../../repository/index.js';
import { ClientRepository } from '../../repository/client.repository.js';
import { InteractionRepository } from '../../repository/interaction.repository.js';
import { ProjectRepository } from '../../repository/project.repository.js';
import { isManagerOrAdmin } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { CLIENT_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';

const UPDATE_MAP = {
  company_name: 'companyName',
  contact_name: 'contactName',
  email: 'email',
  phone: 'phone',
  address: 'address',
} as const;

const SHEET_PROJECTS_LIMIT = 50;
const SHEET_INTERACTIONS_LIMIT = 10;

@Injectable()
export class ClientService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clients: ClientRepository,
    private readonly projects: ProjectRepository,
    private readonly interactions: InteractionRepository,
    private readonly audit: AuditService,
  ) {}

  async list(viewer: AuthenticatedUser, query: ClientListQueryDto) {
    const archived = query.archived ?? 'exclude';

    if (
      !isManagerOrAdmin(viewer) &&
      (archived !== 'exclude' || query.has_unpaid_invoices !== undefined)
    ) {
      throw new AccessDeniedException(
        'Les filtres archived et has_unpaid_invoices sont réservés aux administrateurs et managers.',
      );
    }

    const result = await this.clients.list(viewer.companyId, query, archived, {
      hasProjects: query.has_projects,
      hasUnpaidInvoices: query.has_unpaid_invoices,
    });
    return result.map(toClient);
  }

  /** Fiche client 360° (factures, chiffre d'affaires, solde dû et fichiers : modules à venir). */
  async get(viewer: AuthenticatedUser, id: string) {
    const privileged = isManagerOrAdmin(viewer);
    const { companyId } = viewer;

    // Un collaborateur ne voit pas les clients archivés : 404
    const client = privileged
      ? await this.clients.getByIdIncludingArchived(companyId, id)
      : await this.clients.getById(companyId, id);

    const [projects, projectsCount, recent, interactionsCount] = await Promise.all([
      this.projects.findByClient(companyId, client.id, SHEET_PROJECTS_LIMIT),
      this.projects.countByClient(companyId, client.id),
      this.interactions.recent(companyId, client.id, SHEET_INTERACTIONS_LIMIT),
      this.interactions.countForClient(companyId, client.id),
    ]);

    return {
      ...toClient(client),
      projects: projects.map((project) => toClientProject(project, privileged)),
      recent_interactions: recent.map(toInteraction),
      stats: {
        projects_count: projectsCount,
        interactions_count: interactionsCount,
        last_interaction_at: recent[0]?.interactionDate ?? null,
      },
    };
  }

  async create(user: AuthenticatedUser, dto: CreateClientDto, force: boolean) {
    if (!force) {
      const duplicates = await this.clients.findDuplicates(
        user.companyId,
        dto.company_name,
        dto.email ?? null,
      );
      if (duplicates.length > 0) {
        throw new PotentialDuplicateException(
          'Un client avec le même nom ou la même adresse e-mail existe déjà. Renvoyez la requête avec ?force=true pour le créer quand même.',
          duplicates.map(toDuplicate),
        );
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = this.clients.withManager(manager);
      const created = await repo.createOne(user.companyId, {
        companyName: dto.company_name,
        contactName: dto.contact_name ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        address: dto.address ?? null,
      });
      const client = await repo.getById(user.companyId, created.id);

      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.CLIENT,
          entityId: client.id,
          companyId: user.companyId,
          userId: user.id,
          changes: { after: snapshot(client, CLIENT_AUDIT_FIELDS) },
        },
        manager,
      );
      return toClient(client);
    });
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateClientDto) {
    const changes = mapDto(dto, UPDATE_MAP);

    return this.dataSource.transaction(async (manager) => {
      const repo = this.clients.withManager(manager);
      const before = await repo.getById(user.companyId, id); // 404 si archivé ou étranger

      if (Object.keys(changes).length === 0) return toClient(before);

      // 409 VERSION_CONFLICT si la version envoyée n'est plus la bonne
      const after = await repo.updateWithVersion(
        user.companyId,
        id,
        dto.version,
        changes as UpdateChanges<Client>,
      );

      const diff = diffChanges(before, after, CLIENT_AUDIT_FIELDS);
      if (diff) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.CLIENT,
            entityId: id,
            companyId: user.companyId,
            userId: user.id,
            changes: diff,
          },
          manager,
        );
      }
      return toClient(after);
    });
  }

  /** Idempotent : archiver un client déjà archivé ne fait rien. */
  async archive(user: AuthenticatedUser, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = this.clients.withManager(manager);
      const before = await repo.getByIdIncludingArchived(user.companyId, id);
      if (before.archivedAt) return toClient(before);

      await repo.archive(user.companyId, id);
      await this.audit.record(
        {
          action: AuditAction.ARCHIVE,
          entityType: AuditEntityType.CLIENT,
          entityId: id,
          companyId: user.companyId,
          userId: user.id,
        },
        manager,
      );
      return toClient(await repo.getByIdIncludingArchived(user.companyId, id));
    });
  }

  /** Idempotent : restaurer un client actif ne fait rien. */
  async restore(user: AuthenticatedUser, id: string) {
    return this.dataSource.transaction(async (manager) => {
      const repo = this.clients.withManager(manager);
      const before = await repo.getByIdIncludingArchived(user.companyId, id);
      if (!before.archivedAt) return toClient(before);

      await repo.restore(user.companyId, id);
      await this.audit.record(
        {
          action: AuditAction.RESTORE,
          entityType: AuditEntityType.CLIENT,
          entityId: id,
          companyId: user.companyId,
          userId: user.id,
        },
        manager,
      );
      return toClient(await repo.getByIdIncludingArchived(user.companyId, id));
    });
  }

  /** Suppression définitive : uniquement un client sans aucun historique. */
  async remove(admin: AuthenticatedUser, id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = this.clients.withManager(manager);
      const client = await repo.lockById(admin.companyId, id);

      const history = await repo.historyCounts(admin.companyId, id);
      if (history.projects + history.invoices + history.interactions > 0) {
        throw new ConflictAppException(
          `Ce client a un historique (${history.projects} projet(s), ${history.invoices} facture(s) ou devis, ${history.interactions} interaction(s)) : il ne peut pas être supprimé. Archivez-le à la place.`,
          ErrorCode.REFERENCE_CONFLICT,
        );
      }

      const before = snapshot(client, CLIENT_AUDIT_FIELDS);
      await repo.deleteById(admin.companyId, id);

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entityType: AuditEntityType.CLIENT,
          entityId: id,
          companyId: admin.companyId,
          userId: admin.id,
          changes: { before },
        },
        manager,
      );
    });
  }
}