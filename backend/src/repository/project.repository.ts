import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { Project } from '../entities/project.entity.js';
import { ArchivableTenantRepository } from './archivable-tenant.repository.js';
import type { ArchiveFilter } from './archivable-tenant.repository.js';

@Injectable()
export class ProjectRepository extends ArchivableTenantRepository<Project> {
  protected readonly alias = 'project';
  protected readonly label = 'Projet';
  protected readonly sortableFields = {
    title: 'title',
    status: 'status',
    deadline: 'deadline',
    budget_ht: 'budgetHt',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
  };
  protected readonly defaultSort: SortOrder = { created_at: 'DESC' };

  /** include=... : nom exposé par l'API -> relation de l'entité. */
  private readonly includable = { client: 'client' } as const;

  constructor(@InjectRepository(Project) repo: Repository<Project>) {
    super(repo);
  }

  async list(companyId: string, query: PaginationQueryDto, archived: ArchiveFilter = 'exclude') {
    const qb = this.scoped(companyId, { archived });
    this.applyIncludes(qb, query.include, this.includable);
    return this.paginate(qb, query);
  }
}