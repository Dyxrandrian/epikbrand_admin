import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { PaginatedResult, toSkipTake } from '../dto/index.js';
import type { AuditLogListQueryDto } from '../dto/audit/audit-log-list-query.dto.js';
import { AuditLog } from '../entities/audit-log.entity.js';

export interface AuditLogValues {
  companyId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
}

@Injectable()
export class AuditLogRepository {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  /** Avec `manager`, l'écriture fait partie de la transaction de l'appelant. */
  async append(values: AuditLogValues, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    await repo.save(repo.create(values));
  }

  async list(companyId: string, filters: AuditLogListQueryDto): Promise<PaginatedResult<AuditLog>> {
    if (typeof companyId !== 'string' || companyId.length === 0) {
      throw new Error('companyId obligatoire : le journal est cloisonné par entreprise.');
    }

    const qb = this.repo
      .createQueryBuilder('log')
      .where('log.companyId = :companyId', { companyId });

    if (filters.entity_type) {
      qb.andWhere('log.entityType = :entityType', { entityType: filters.entity_type });
    }
    if (filters.entity_id) qb.andWhere('log.entityId = :entityId', { entityId: filters.entity_id });
    if (filters.user_id) qb.andWhere('log.userId = :userId', { userId: filters.user_id });
    if (filters.action) qb.andWhere('log.action = :action', { action: filters.action });
    if (filters.from) qb.andWhere('log.createdAt >= :from', { from: new Date(filters.from) });
    if (filters.to) qb.andWhere('log.createdAt <= :to', { to: new Date(filters.to) });

    qb.orderBy('log.createdAt', 'DESC').addOrderBy('log.id', 'DESC');

    const { skip, take } = toSkipTake(filters);
    const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
    return new PaginatedResult(items, total, filters.page, filters.per_page);
  }
}