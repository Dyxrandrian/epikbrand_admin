import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import type { SortOrder } from '../dto/index.js';
import type { InteractionFiltersDto } from '../dto/interactions/interaction-list-query.dto.js';
import { Interaction } from '../entities/interaction.entity.js';
import { ResourceNotFoundException, ValidationFailedException } from '../exceptions/index.js';
import { applyWordSearch } from './search.js';
import { TenantRepository } from './tenant.repository.js';

const INCLUDABLE = ['client', 'author'] as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface InteractionListOptions {
  /** Restreint à un client (liste par client). */
  clientId?: string;
  /** Exclut les interactions des clients archivés (collaborateurs). */
  activeClientsOnly?: boolean;
}

@Injectable()
export class InteractionRepository extends TenantRepository<Interaction> {
  protected readonly alias = 'itx';
  protected readonly label = 'Interaction';
  protected readonly sortableFields = { interaction_date: 'interactionDate' };
  protected readonly defaultSort: SortOrder = { interaction_date: 'DESC' };

  constructor(@InjectRepository(Interaction) repo: Repository<Interaction>) {
    super(repo);
  }

  async list(
    companyId: string,
    query: InteractionFiltersDto,
    options: InteractionListOptions = {},
  ) {
    const qb = this.scoped(companyId);
    this.applyInteractionIncludes(qb, query.include);

    if (options.clientId) {
      qb.andWhere('itx.clientId = :clientId', { clientId: options.clientId });
    }
    if (options.activeClientsOnly) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM clients c
                  WHERE c.id = "itx"."client_id"
                    AND c.company_id = "itx"."company_id"
                    AND c.archived_at IS NULL)`,
      );
    }
    if (query.type) qb.andWhere('itx.type = :interactionType', { interactionType: query.type });
    if (query.user_id) qb.andWhere('itx.userId = :authorId', { authorId: query.user_id });
    if (query.from) {
      qb.andWhere('itx.interactionDate >= :periodFrom', { periodFrom: new Date(query.from) });
    }
    if (query.to) {
      if (DATE_ONLY.test(query.to)) {
        // Date seule : toute la journée (UTC) est incluse
        const nextDay = new Date(query.to);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        qb.andWhere('itx.interactionDate < :periodToExclusive', { periodToExclusive: nextDay });
      } else {
        qb.andWhere('itx.interactionDate <= :periodTo', { periodTo: new Date(query.to) });
      }
    }

    applyWordSearch(qb, '"itx"."summary"', query.q);
    return this.paginate(qb, query);
  }

  /** Dernières interactions d'un client (fiche 360°). */
  recent(companyId: string, clientId: string, limit: number): Promise<Interaction[]> {
    const qb = this.scoped(companyId).andWhere('itx.clientId = :clientId', { clientId });
    this.applyInteractionIncludes(qb, ['author']);
    return qb
      .orderBy('itx.interactionDate', 'DESC')
      .addOrderBy('itx.id', 'ASC')
      .take(limit)
      .getMany();
  }

  countForClient(companyId: string, clientId: string): Promise<number> {
    return this.scoped(companyId).andWhere('itx.clientId = :clientId', { clientId }).getCount();
  }

  /** Une interaction avec son auteur (réponses de création et de modification). */
  async getDetailed(companyId: string, id: string): Promise<Interaction> {
    const qb = this.scoped(companyId).andWhere('itx.id = :id', { id });
    this.applyInteractionIncludes(qb, ['author']);
    const item = await qb.getOne();
    if (!item) throw new ResourceNotFoundException(this.label);
    return item;
  }

  private applyInteractionIncludes(
    qb: SelectQueryBuilder<Interaction>,
    include: readonly string[] | undefined,
  ): void {
    if (!include?.length) return;

    const unknown = include.filter((name) => !(INCLUDABLE as readonly string[]).includes(name));
    if (unknown.length > 0) {
      throw new ValidationFailedException([
        {
          field: 'include',
          reason: 'includeNotAllowed',
          message: `Relations non disponibles : ${unknown.join(', ')}. Disponibles : ${INCLUDABLE.join(', ')}.`,
        },
      ]);
    }

    const wanted = new Set(include);
    if (wanted.has('client')) {
      qb.leftJoin('itx.client', 'inc_client').addSelect(['inc_client.id', 'inc_client.companyName']);
    }
    if (wanted.has('author')) {
      qb.leftJoin('itx.user', 'inc_author').addSelect([
        'inc_author.id',
        'inc_author.name',
        'inc_author.avatarUrl',
      ]);
    }
  }
}