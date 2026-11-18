import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { Client } from '../entities/client.entity.js';
import { ArchivableTenantRepository } from './archivable-tenant.repository.js';
import type { ArchiveFilter } from './archivable-tenant.repository.js';

@Injectable()
export class ClientRepository extends ArchivableTenantRepository<Client> {
  protected readonly alias = 'client';
  protected readonly label = 'Client';
  protected readonly sortableFields = {
    company_name: 'companyName',
    created_at: 'createdAt',
    updated_at: 'updatedAt',
  };
  protected readonly defaultSort: SortOrder = { company_name: 'ASC' };

  constructor(@InjectRepository(Client) repo: Repository<Client>) {
    super(repo);
  }

  async list(companyId: string, query: PaginationQueryDto, archived: ArchiveFilter = 'exclude') {
    return this.paginate(this.scoped(companyId, { archived }), query);
  }
}