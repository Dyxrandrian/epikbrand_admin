import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { Client } from '../entities/client.entity.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { ArchivableTenantRepository } from './archivable-tenant.repository.js';
import type { ArchiveFilter } from './archivable-tenant.repository.js';
import { applyWordSearch } from './search.js';

// Doit être identique à l'expression de l'index idx_search_clients
const SEARCH_TEXT = `"client"."company_name" || ' ' || coalesce("client"."contact_name", '') || ' ' || coalesce("client"."email", '') || ' ' || coalesce("client"."phone", '')`;

const MAX_DUPLICATES_SHOWN = 5;

export interface ClientFilters {
  hasProjects?: boolean;
  hasUnpaidInvoices?: boolean;
}

export interface ClientHistory {
  projects: number;
  invoices: number;
  interactions: number;
}

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

  async list(
    companyId: string,
    query: PaginationQueryDto,
    archived: ArchiveFilter = 'exclude',
    filters: ClientFilters = {},
  ) {
    const qb = this.scoped(companyId, { archived });
    this.applyIncludes(qb, query.include, {}); // aucune relation disponible : include est refusé

    if (filters.hasProjects !== undefined) {
      qb.andWhere(
        `${filters.hasProjects ? '' : 'NOT '}EXISTS (
           SELECT 1 FROM projects p
            WHERE p.company_id = "client"."company_id"
              AND p.client_id = "client"."id"
              AND p.archived_at IS NULL)`,
      );
    }
    if (filters.hasUnpaidInvoices !== undefined) {
      // Impayée = facture (ni devis ni avoir) envoyée ou en retard
      qb.andWhere(
        `${filters.hasUnpaidInvoices ? '' : 'NOT '}EXISTS (
           SELECT 1 FROM invoices i
            WHERE i.company_id = "client"."company_id"
              AND i.client_id = "client"."id"
              AND i.type = 'invoice'
              AND i.status IN ('sent', 'overdue'))`,
      );
    }

    applyWordSearch(qb, SEARCH_TEXT, query.q);
    return this.paginate(qb, query);
  }

  /** Clients (archivés compris) de même nom ou de même e-mail. */
  async findDuplicates(
    companyId: string,
    companyName: string,
    email: string | null,
  ): Promise<Client[]> {
    const conditions = [
      `immutable_unaccent(lower("client"."company_name")) = immutable_unaccent(lower(CAST(:dupName AS text)))`,
    ];
    const params: Record<string, string> = { dupName: companyName };
    if (email) {
      conditions.push(`lower("client"."email") = lower(CAST(:dupEmail AS text))`);
      params.dupEmail = email;
    }

    return this.scoped(companyId, { archived: 'include' })
      .andWhere(`(${conditions.join(' OR ')})`, params)
      .orderBy('client.companyName', 'ASC')
      .addOrderBy('client.id', 'ASC')
      .take(MAX_DUPLICATES_SHOWN)
      .getMany();
  }

  /**
   * Verrouille la ligne jusqu'à la fin de la transaction (via withManager()).
   * Une interaction créée en même temps attend, puis échoue si le client a été supprimé.
   */
  async lockById(companyId: string, id: string): Promise<Client> {
    const client = await this.scoped(companyId, { archived: 'include' })
      .andWhere('client.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!client) throw new ResourceNotFoundException(this.label);
    return client;
  }

  /** Historique qui interdit la suppression définitive. */
  async historyCounts(companyId: string, clientId: string): Promise<ClientHistory> {
    const rows: ClientHistory[] = await this.repo.manager.query(
      `SELECT
         (SELECT COUNT(*)::int FROM projects     WHERE company_id = $1 AND client_id = $2) AS projects,
         (SELECT COUNT(*)::int FROM invoices     WHERE company_id = $1 AND client_id = $2) AS invoices,
         (SELECT COUNT(*)::int FROM interactions WHERE company_id = $1 AND client_id = $2) AS interactions`,
      [companyId, clientId],
    );
    return rows[0];
  }
}