import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { TrainingRequest } from '../entities/training-request.entity.js';
import { RequestStatus } from '../enums/app.enums.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import type { RequestViewer } from './leave-request.repository.js';
import { TenantRepository } from './tenant.repository.js';
import type { UpdateChanges } from './tenant.repository.js';

export interface TrainingFilters {
  statuses?: RequestStatus[];
  userId?: string;
  /** Dates locales AAAA-MM-JJ de la demande, interprétées dans le fuseau de l'entreprise. */
  from?: string;
  to?: string;
  timeZone: string;
}

const SUMMARY_LIMIT = 2000;

@Injectable()
export class TrainingRequestRepository extends TenantRepository<TrainingRequest> {
  protected readonly alias = 'trq';
  protected readonly label = 'Demande de formation';
  protected readonly sortableFields = {
    created_at: 'createdAt',
    reviewed_at: 'reviewedAt',
    training_name: 'trainingName',
  };
  protected readonly defaultSort: SortOrder = { created_at: 'DESC' };

  constructor(@InjectRepository(TrainingRequest) repo: Repository<TrainingRequest>) {
    super(repo);
  }

  list(
    companyId: string,
    query: PaginationQueryDto,
    viewer: RequestViewer,
    filters: TrainingFilters,
  ) {
    const qb = this.scoped(companyId);
    this.applyIncludes(qb, query.include, {});
    this.restrictToOwner(qb, viewer);
    this.joinUser(qb);

    if (filters.statuses?.length) {
      qb.andWhere('trq.status IN (:...fStatuses)', { fStatuses: filters.statuses });
    }
    if (filters.userId) qb.andWhere('trq.userId = :fUser', { fUser: filters.userId });
    if (filters.from) {
      qb.andWhere(`CAST("trq"."created_at" AT TIME ZONE :fTz AS date) >= CAST(:fFrom AS date)`, {
        fTz: filters.timeZone,
        fFrom: filters.from,
      });
    }
    if (filters.to) {
      qb.andWhere(`CAST("trq"."created_at" AT TIME ZONE :fTz AS date) <= CAST(:fTo AS date)`, {
        fTz: filters.timeZone,
        fTo: filters.to,
      });
    }
    return this.paginate(qb, query);
  }

  async getDetailed(companyId: string, id: string, viewer: RequestViewer): Promise<TrainingRequest> {
    const qb = this.scoped(companyId).andWhere('trq.id = :detailId', { detailId: id });
    this.restrictToOwner(qb, viewer);
    this.joinUser(qb);

    const request = await qb.getOne();
    if (!request) throw new ResourceNotFoundException(this.label);
    return request;
  }

  async lockById(companyId: string, id: string): Promise<TrainingRequest> {
    const request = await this.scoped(companyId)
      .andWhere('trq.id = :lockId', { lockId: id })
      .setLock('pessimistic_write')
      .getOne();
    if (!request) throw new ResourceNotFoundException(this.label);
    return request;
  }

  /** Formations approuvées dont la décision tombe dans la période (fuseau de l'entreprise). */
  approvedInPeriod(
    companyId: string,
    period: { from?: string; to?: string; timeZone: string },
  ): Promise<TrainingRequest[]> {
    const qb = this.scoped(companyId)
      .andWhere('trq.status = :apprStatus', { apprStatus: RequestStatus.APPROVED })
      .andWhere('trq.reviewedAt IS NOT NULL');
    this.joinUser(qb);

    if (period.from) {
      qb.andWhere(`CAST("trq"."reviewed_at" AT TIME ZONE :pTz AS date) >= CAST(:pFrom AS date)`, {
        pTz: period.timeZone,
        pFrom: period.from,
      });
    }
    if (period.to) {
      qb.andWhere(`CAST("trq"."reviewed_at" AT TIME ZONE :pTz AS date) <= CAST(:pTo AS date)`, {
        pTz: period.timeZone,
        pTo: period.to,
      });
    }
    return qb.orderBy('trq.reviewedAt', 'DESC').addOrderBy('trq.id', 'ASC').limit(SUMMARY_LIMIT).getMany();
  }

  insertRequest(companyId: string, data: Record<string, unknown>): Promise<TrainingRequest> {
    return this.createOne(companyId, data as never);
  }

  changeRequest(
    companyId: string,
    id: string,
    changes: Record<string, unknown>,
  ): Promise<TrainingRequest> {
    return this.updateById(companyId, id, changes as unknown as UpdateChanges<TrainingRequest>);
  }

  private restrictToOwner(qb: SelectQueryBuilder<TrainingRequest>, viewer: RequestViewer): void {
    if (!viewer.privileged) qb.andWhere('trq.userId = :ownerId', { ownerId: viewer.id });
  }

  private joinUser(qb: SelectQueryBuilder<TrainingRequest>): void {
    qb.leftJoin('trq.user', 'inc_user').addSelect([
      'inc_user.id',
      'inc_user.name',
      'inc_user.avatarUrl',
      'inc_user.jobTitle',
    ]);
  }
}