import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { mapDto } from '../../dto/map-dto.js';
import type {
  ChangeProjectStatusDto,
  CreateProjectDto,
  DeadlineFilter,
  DuplicateProjectDto,
  ProjectListQueryDto,
  UpdateProjectDto,
} from '../../dto/projects/index.js';
import type { Project } from '../../entities/project.entity.js';
import { ProjectStatus } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  AccessDeniedException,
  ConfirmationRequiredException,
  ResourceNotFoundException,
} from '../../exceptions/index.js';
import { toProject, toTeamMember } from '../../mapper/project.mapper.js';
import { ClientRepository } from '../../repository/client.repository.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { ProjectRepository, emptyTaskStats } from '../../repository/project.repository.js';
import type { ProjectFilters } from '../../repository/project.repository.js';
import type { UpdateChanges } from '../../repository/index.js';
import { isManagerOrAdmin } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { PROJECT_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { monthRange, todayIn, weekRange } from './project-dates.js';
import { NotificationService } from '../notifications/notification.service.js';
import { notificationTemplates } from '../notifications/notification-templates.js';

const UPDATE_MAP = {
  client_id: 'clientId',
  title: 'title',
  description: 'description',
  budget_ht: 'budgetHt',
  deadline: 'deadline',
} as const;

@Injectable()
export class ProjectService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projects: ProjectRepository,
    private readonly clients: ClientRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) { }

  async list(viewer: AuthenticatedUser, query: ProjectListQueryDto) {
    const privileged = isManagerOrAdmin(viewer);
    const archived = query.archived ?? 'exclude';

    if (!privileged && archived !== 'exclude') {
      throw new AccessDeniedException(
        'Le filtre archived est réservé aux administrateurs et managers.',
      );
    }
    if (!privileged && this.sortsOnBudget(query.sort)) {
      throw new AccessDeniedException(
        'Le tri par budget est réservé aux administrateurs et managers.',
      );
    }

    const today = await this.todayFor(viewer.companyId);
    const filters: ProjectFilters = {
      status: query.status,
      clientId: query.client_id,
      ...this.deadlineFilter(query.deadline, today),
    };
    // Un collaborateur ne voit que les projets où il est assigné à une tâche
    if (!privileged) filters.participantId = viewer.id;

    const result = await this.projects.list(viewer.companyId, query, archived, filters);
    const stats = await this.projects.taskStats(
      viewer.companyId,
      result.items.map((project) => project.id),
    );

    return result.map((project) =>
      toProject(project, {
        includeBudget: privileged,
        today,
        stats: stats.get(project.id) ?? emptyTaskStats(),
      }),
    );
  }

  /** Fiche projet (fichiers, dépenses, factures et rentabilité : modules à venir). */
  async get(viewer: AuthenticatedUser, id: string) {
    const privileged = isManagerOrAdmin(viewer);
    const { companyId } = viewer;

    const project = await this.projects.getWithClient(companyId, id, {
      includeArchived: privileged,
    });
    // Un collaborateur non assigné à ce projet reçoit un 404, comme s'il n'existait pas
    if (!privileged && !(await this.projects.isParticipant(companyId, id, viewer.id))) {
      throw new ResourceNotFoundException('Projet');
    }

    const [today, stats, team] = await Promise.all([
      this.todayFor(companyId),
      this.projects.taskStats(companyId, [id]),
      this.projects.team(companyId, id),
    ]);

    return {
      ...toProject(project, {
        includeBudget: privileged,
        today,
        stats: stats.get(id) ?? emptyTaskStats(),
      }),
      team: team.map(toTeamMember),
    };
  }

  async create(user: AuthenticatedUser, dto: CreateProjectDto) {
    // Le client doit exister, être actif et appartenir à l'entreprise (sinon 422 sur client_id)
    await this.clients.assertReference(user.companyId, dto.client_id, 'client_id');

    const project = await this.dataSource.transaction(async (manager) => {
      const repo = this.projects.withManager(manager);
      const created = await repo.createOne(user.companyId, {
        clientId: dto.client_id,
        title: dto.title,
        description: dto.description ?? null,
        budgetHt: dto.budget_ht ?? 0,
        status: dto.status ?? ProjectStatus.PENDING,
        deadline: dto.deadline ?? null,
      });
      const fresh = await repo.getById(user.companyId, created.id);

      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.PROJECT,
          entityId: fresh.id,
          companyId: user.companyId,
          userId: user.id,
          changes: { after: snapshot(fresh, PROJECT_AUDIT_FIELDS) },
        },
        manager,
      );
      return fresh;
    });
    return this.present(user, project);
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateProjectDto) {
    const changes = mapDto(dto, UPDATE_MAP);

    const project = await this.dataSource.transaction(async (manager) => {
      const repo = this.projects.withManager(manager);
      const before = await repo.getById(user.companyId, id); // 404 si archivé ou étranger

      // Changement de client : le nouveau doit être actif et de la même entreprise
      if (dto.client_id !== undefined && dto.client_id !== before.clientId) {
        await this.clients.assertReference(user.companyId, dto.client_id, 'client_id');
      }
      if (Object.keys(changes).length === 0) return before;

      // 409 VERSION_CONFLICT si la version envoyée n'est plus la bonne
      const after = await repo.updateWithVersion(
        user.companyId,
        id,
        dto.version,
        changes as UpdateChanges<Project>,
      );

      const diff = diffChanges(before, after, PROJECT_AUDIT_FIELDS);
      if (diff) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.PROJECT,
            entityId: id,
            companyId: user.companyId,
            userId: user.id,
            changes: diff,
          },
          manager,
        );
      }
      return after;
    });
    return this.present(user, project);
  }

  /**
   * Changement de statut. Passer à « livré » avec des tâches non terminées exige une
   * confirmation (409 CONFIRMATION_REQUIRED, puis renvoi avec ?confirm=true).
   * Les membres du projet sont notifiés (sauf l'auteur du changement).
   */
  async changeStatus(
    user: AuthenticatedUser,
    id: string,
    dto: ChangeProjectStatusDto,
    confirm: boolean,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = this.projects.withManager(manager);
      const before = await repo.getById(user.companyId, id);
      if (before.status === dto.status) return { project: before, memberIds: null as string[] | null };

      if (dto.status === ProjectStatus.DELIVERED && !confirm) {
        const stats = (await repo.taskStats(user.companyId, [id])).get(id) ?? emptyTaskStats();
        const unfinished = stats.total - stats.done;
        if (unfinished > 0) {
          throw new ConfirmationRequiredException(
            `Ce projet a encore ${unfinished} tâche(s) non terminée(s). Renvoyez la requête avec ?confirm=true pour le marquer comme livré quand même.`,
            { unfinished_tasks: unfinished, total_tasks: stats.total },
          );
        }
      }

      const after = await repo.updateWithVersion(user.companyId, id, dto.version, {
        status: dto.status,
      } as UpdateChanges<Project>);

      const diff = diffChanges(before, after, PROJECT_AUDIT_FIELDS);
      if (diff) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.PROJECT,
            entityId: id,
            companyId: user.companyId,
            userId: user.id,
            changes: diff,
          },
          manager,
        );
      }

      const members = await repo.team(user.companyId, id);
      return { project: after, memberIds: members.map((member) => member.id) };
    });

    if (result.memberIds) {
      await this.notifications.notify({
        companyId: user.companyId,
        recipientIds: result.memberIds,
        actorId: user.id,
        ...notificationTemplates.projectStatusChanged(
          { id, title: result.project.title },
          result.project.status,
        ),
      });
    }
    return this.present(user, result.project);
  }

  /** Idempotent : archiver un projet déjà archivé ne fait rien. */
  async archive(user: AuthenticatedUser, id: string) {
    const project = await this.dataSource.transaction(async (manager) => {
      const repo = this.projects.withManager(manager);
      const before = await repo.getByIdIncludingArchived(user.companyId, id);
      if (before.archivedAt) return before;

      await repo.archive(user.companyId, id);
      await this.audit.record(
        {
          action: AuditAction.ARCHIVE,
          entityType: AuditEntityType.PROJECT,
          entityId: id,
          companyId: user.companyId,
          userId: user.id,
        },
        manager,
      );
      return repo.getByIdIncludingArchived(user.companyId, id);
    });
    return this.present(user, project);
  }

  /** Idempotent : restaurer un projet actif ne fait rien. */
  async restore(user: AuthenticatedUser, id: string) {
    const project = await this.dataSource.transaction(async (manager) => {
      const repo = this.projects.withManager(manager);
      const before = await repo.getByIdIncludingArchived(user.companyId, id);
      if (!before.archivedAt) return before;

      await repo.restore(user.companyId, id);
      await this.audit.record(
        {
          action: AuditAction.RESTORE,
          entityType: AuditEntityType.PROJECT,
          entityId: id,
          companyId: user.companyId,
          userId: user.id,
        },
        manager,
      );
      return repo.getByIdIncludingArchived(user.companyId, id);
    });
    return this.present(user, project);
  }

  /** Duplique un projet (même archivé) avec ses tâches actives : modèle réutilisable. */
  async duplicate(user: AuthenticatedUser, sourceId: string, dto: DuplicateProjectDto) {
    const source = await this.projects.getByIdIncludingArchived(user.companyId, sourceId);

    // Le client de la copie doit être actif : si celui d'origine est archivé, indiquez-en un autre
    const clientId = dto.client_id ?? source.clientId;
    await this.clients.assertReference(user.companyId, clientId, 'client_id');

    const title = (dto.title ?? `Copie de ${source.title}`).slice(0, 150);

    const project = await this.dataSource.transaction(async (manager) => {
      const repo = this.projects.withManager(manager);
      const created = await repo.createOne(user.companyId, {
        clientId,
        title,
        description: source.description,
        budgetHt: source.budgetHt,
        status: ProjectStatus.PENDING,
        deadline: null,
      });
      const copied = await repo.copyTasks(user.companyId, source.id, created.id, user.id);
      const fresh = await repo.getById(user.companyId, created.id);

      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.PROJECT,
          entityId: fresh.id,
          companyId: user.companyId,
          userId: user.id,
          changes: {
            after: {
              ...snapshot(fresh, PROJECT_AUDIT_FIELDS),
              duplicated_from: source.id,
              tasks_copied: copied,
            },
          },
        },
        manager,
      );
      return fresh;
    });
    return this.present(user, project);
  }

  /**
   * Suppression définitive (admin). La base supprime en cascade les tâches et fichiers, et
   * détache les factures et dépenses : si quelque chose est concerné, confirmation obligatoire.
   */
  async remove(admin: AuthenticatedUser, id: string, confirm: boolean): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = this.projects.withManager(manager);
      const project = await repo.lockById(admin.companyId, id);

      const impact = await repo.deletionImpact(admin.companyId, id);
      const concerned = impact.tasks + impact.files + impact.invoices + impact.expenses;
      if (concerned > 0 && !confirm) {
        throw new ConfirmationRequiredException(
          `Cette suppression est définitive : ${impact.tasks} tâche(s) (avec leurs commentaires) et ${impact.files} fichier(s) seront effacés, ${impact.invoices} facture(s) ou devis et ${impact.expenses} dépense(s) seront détachés du projet. Renvoyez la requête avec ?confirm=true pour confirmer. Pour conserver l'historique, archivez le projet à la place.`,
          { ...impact },
        );
      }

      const before = snapshot(project, PROJECT_AUDIT_FIELDS);
      await repo.deleteById(admin.companyId, id);

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entityType: AuditEntityType.PROJECT,
          entityId: id,
          companyId: admin.companyId,
          userId: admin.id,
          changes: {
            before,
            after: {
              deleted_tasks: impact.tasks,
              deleted_files: impact.files,
              detached_invoices: impact.invoices,
              detached_expenses: impact.expenses,
            },
          },
        },
        manager,
      );
    });
  }

  // ---------- Outils internes ----------

  /** Projet tel que renvoyé après une écriture (réservée à admin et manager). */
  private async present(viewer: AuthenticatedUser, project: Project) {
    const [today, stats] = await Promise.all([
      this.todayFor(viewer.companyId),
      this.projects.taskStats(viewer.companyId, [project.id]),
    ]);
    return toProject(project, {
      includeBudget: isManagerOrAdmin(viewer),
      today,
      stats: stats.get(project.id) ?? emptyTaskStats(),
    });
  }

  /** « Aujourd'hui » dans le fuseau de l'entreprise (et non en UTC). */
  private async todayFor(companyId: string): Promise<string> {
    const company = await this.companies.getById(companyId);
    return todayIn(company.timezone);
  }

  private deadlineFilter(kind: DeadlineFilter | undefined, today: string): ProjectFilters {
    switch (kind) {
      case 'overdue':
        return { dueBefore: today, openOnly: true };
      case 'this_week': {
        const range = weekRange(today);
        return { dueFrom: range.from, dueTo: range.to };
      }
      case 'this_month': {
        const range = monthRange(today);
        return { dueFrom: range.from, dueTo: range.to };
      }
      default:
        return {};
    }
  }

  private sortsOnBudget(sort: string | undefined): boolean {
    return !!sort && sort.split(',').some((part) => part.replace(/^-/, '') === 'budget_ht');
  }
}