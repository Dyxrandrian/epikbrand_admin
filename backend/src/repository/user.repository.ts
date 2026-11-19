import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SortOrder } from '../dto/index.js';
import type { UserListQueryDto } from '../dto/users/user-list-query.dto.js';
import { User } from '../entities/user.entity.js';
import { UserRole } from '../enums/app.enums.js';
import { applyWordSearch } from './search.js';
import { TenantRepository } from './tenant.repository.js';

const DIRECTORY_TEXT = `"usr"."name" || ' ' || CAST("usr"."email" AS text) || ' ' || coalesce("usr"."job_title", '')`;
const FULL_TEXT = `${DIRECTORY_TEXT} || ' ' || coalesce("usr"."matricule", '')`;

/** Plafond de l'organigramme (une PME n'en approche pas). */
const DIRECTORY_MAX_USERS = 1000;

export interface UserListScope {
  /** Admin et manager : recherche aussi sur le matricule, tous les statuts. */
  privileged: boolean;
}

@Injectable()
export class UserRepository extends TenantRepository<User> {
  protected readonly alias = 'usr';
  protected readonly label = 'Utilisateur';
  protected readonly sortableFields = {
    name: 'name',
    email: 'email',
    job_title: 'jobTitle',
    created_at: 'createdAt',
  };
  protected readonly defaultSort: SortOrder = { name: 'ASC' };

  constructor(@InjectRepository(User) repo: Repository<User>) {
    super(repo);
  }

  async list(companyId: string, query: UserListQueryDto, scope: UserListScope) {
    const qb = this.scoped(companyId);
    this.applyIncludes(qb, query.include, {}); // aucune relation disponible : include est refusé

    if (!scope.privileged) {
      qb.andWhere('usr.isActive = true');
    } else if (query.is_active !== undefined) {
      qb.andWhere('usr.isActive = :isActive', { isActive: query.is_active });
    }
    if (query.role) qb.andWhere('usr.role = :role', { role: query.role });

    applyWordSearch(qb, scope.privileged ? FULL_TEXT : DIRECTORY_TEXT, query.q);
    return this.paginate(qb, query);
  }

  /** Utilisateurs actifs de l'entreprise, pour l'organigramme. */
  directory(companyId: string): Promise<User[]> {
    return this.scoped(companyId)
      .andWhere('usr.isActive = true')
      .orderBy('usr.name', 'ASC')
      .addOrderBy('usr.id', 'ASC')
      .take(DIRECTORY_MAX_USERS)
      .getMany();
  }

  /**
   * Verrouille les administrateurs actifs de l'entreprise jusqu'à la fin de la transaction :
   * deux requêtes simultanées ne peuvent pas retirer chacune « l'avant-dernier » admin.
   * À appeler uniquement sur un repository obtenu par withManager().
   */
  lockActiveAdmins(companyId: string): Promise<User[]> {
    return this.scoped(companyId)
      .andWhere('usr.role = :adminRole', { adminRole: UserRole.ADMIN })
      .andWhere('usr.isActive = true')
      .setLock('pessimistic_write')
      .getMany();
  }

  /** Vrai si l'utilisateur a un historique qui interdit sa suppression définitive. */
  async hasLinkedData(companyId: string, userId: string): Promise<boolean> {
    const rows: Array<{ linked: boolean }> = await this.repo.manager.query(
      `SELECT (
         EXISTS (SELECT 1 FROM leave_requests WHERE company_id = $1 AND (user_id = $2 OR reviewed_by = $2))
         OR EXISTS (SELECT 1 FROM training_requests WHERE company_id = $1 AND (user_id = $2 OR reviewed_by = $2))
         OR EXISTS (SELECT 1 FROM salaries WHERE company_id = $1 AND user_id = $2)
         OR EXISTS (SELECT 1 FROM expenses WHERE company_id = $1 AND user_id = $2)
         OR EXISTS (SELECT 1 FROM task_assignees WHERE user_id = $2)
         OR EXISTS (SELECT 1 FROM tasks WHERE company_id = $1 AND created_by = $2)
         OR EXISTS (SELECT 1 FROM task_comments WHERE company_id = $1 AND user_id = $2)
         OR EXISTS (SELECT 1 FROM interactions WHERE company_id = $1 AND user_id = $2)
         OR EXISTS (SELECT 1 FROM media_attachments WHERE company_id = $1 AND uploaded_by = $2)
         OR EXISTS (SELECT 1 FROM agency_articles WHERE company_id = $1 AND updated_by = $2)
         OR EXISTS (SELECT 1 FROM agency_article_versions WHERE edited_by = $2)
         OR EXISTS (SELECT 1 FROM audit_logs WHERE company_id = $1 AND user_id = $2)
       ) AS linked`,
      [companyId, userId],
    );
    return rows[0].linked;
  }
}