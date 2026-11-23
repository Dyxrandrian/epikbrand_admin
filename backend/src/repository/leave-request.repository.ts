import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { LeaveRequest } from '../entities/leave-request.entity.js';
import { RequestStatus } from '../enums/app.enums.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { slotEnd, slotStart } from '../services/hr/leave-calendar.js';
import type { LeaveSpan } from '../services/hr/leave-calendar.js';
import { escapeLike, searchWords } from './search.js';
import { TenantRepository } from './tenant.repository.js';
import type { UpdateChanges } from './tenant.repository.js';

export interface RequestViewer {
  id: string;
  /** Admin ou manager : voit les demandes de toute l'entreprise. */
  privileged: boolean;
}

export interface LeaveFilters {
  statuses?: RequestStatus[];
  userId?: string;
  leaveTypeId?: string;
  from?: string;
  to?: string;
}

export interface LeaveSpanRow extends LeaveSpan {
  id: string;
  leaveTypeId: string;
  status: RequestStatus;
}

// Mêmes formules que la contrainte d'exclusion de la base (migration HrRequestsOverhaul)
const slotStartSql = (a: string): string =>
  `((${a}."start_date" - DATE '2000-01-01') * 2 + CASE WHEN ${a}."start_half_day" THEN 1 ELSE 0 END)`;
const slotEndSql = (a: string): string =>
  `((${a}."end_date" - DATE '2000-01-01') * 2 + CASE WHEN ${a}."end_half_day" THEN 0 ELSE 1 END)`;

const SPAN_COLUMNS = `r.id,
       r.leave_type_id AS "leaveTypeId",
       r.status::text AS status,
       to_char(r.start_date, 'YYYY-MM-DD') AS "startDate",
       to_char(r.end_date, 'YYYY-MM-DD') AS "endDate",
       r.start_half_day AS "startHalfDay",
       r.end_half_day AS "endHalfDay"`;

const CALENDAR_LIMIT = 1000;
const OVERLAPS_SHOWN = 20;

@Injectable()
export class LeaveRequestRepository extends TenantRepository<LeaveRequest> {
  protected readonly alias = 'lreq';
  protected readonly label = 'Demande de congé';
  protected readonly sortableFields = {
    start_date: 'startDate',
    end_date: 'endDate',
    days_count: 'daysCount',
    created_at: 'createdAt',
  };
  protected readonly defaultSort: SortOrder = { created_at: 'DESC' };

  constructor(@InjectRepository(LeaveRequest) repo: Repository<LeaveRequest>) {
    super(repo);
  }

  // ---------- Lectures ----------

  list(
    companyId: string,
    query: PaginationQueryDto,
    viewer: RequestViewer,
    filters: LeaveFilters,
  ) {
    const qb = this.scoped(companyId);
    this.applyIncludes(qb, query.include, {}); // aucune relation à la demande : include est refusé
    this.restrictToOwner(qb, viewer);
    this.joinPeople(qb);

    if (filters.statuses?.length) {
      qb.andWhere('lreq.status IN (:...fStatuses)', { fStatuses: filters.statuses });
    }
    if (filters.userId) qb.andWhere('lreq.userId = :fUser', { fUser: filters.userId });
    if (filters.leaveTypeId) {
      qb.andWhere('lreq.leaveTypeId = :fType', { fType: filters.leaveTypeId });
    }
    if (filters.from) qb.andWhere('lreq.endDate >= :fFrom', { fFrom: filters.from });
    if (filters.to) qb.andWhere('lreq.startDate <= :fTo', { fTo: filters.to });

    // Recherche : nom du demandeur
    searchWords(query.q).forEach((word, index) => {
      const param = `qword_${index}`;
      qb.andWhere(
        `f_unaccent("inc_user"."name") ILIKE '%' || f_unaccent(CAST(:${param} AS text)) || '%'`,
        { [param]: escapeLike(word) },
      );
    });
    return this.paginate(qb, query);
  }

  /** Demande avec son demandeur et son type ; 404 si elle n'est pas visible par ce lecteur. */
  async getDetailed(companyId: string, id: string, viewer: RequestViewer): Promise<LeaveRequest> {
    const qb = this.scoped(companyId).andWhere('lreq.id = :detailId', { detailId: id });
    this.restrictToOwner(qb, viewer);
    this.joinPeople(qb);

    const request = await qb.getOne();
    if (!request) throw new ResourceNotFoundException(this.label);
    return request;
  }

  /** Verrouille la ligne jusqu'à la fin de la transaction (via withManager()). */
  async lockById(companyId: string, id: string): Promise<LeaveRequest> {
    const request = await this.scoped(companyId)
      .andWhere('lreq.id = :lockId', { lockId: id })
      .setLock('pessimistic_write')
      .getOne();
    if (!request) throw new ResourceNotFoundException(this.label);
    return request;
  }

  /**
   * Verrou de transaction par personne : création, approbation et annulation de ses demandes
   * se déroulent l'une après l'autre (contrôle du solde et des chevauchements fiable).
   * À appeler uniquement sur un repository obtenu par withManager().
   */
  async lockUser(companyId: string, userId: string): Promise<void> {
    await this.repo.manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `leave:${this.requireCompanyId(companyId)}:${userId}`,
    ]);
  }

  /** Première demande en attente ou approuvée de cette personne qui chevauche ces créneaux. */
  async findOverlap(
    companyId: string,
    userId: string,
    span: LeaveSpan,
    excludeId: string | null = null,
  ): Promise<{ id: string; startDate: string; endDate: string; status: RequestStatus } | null> {
    const rows: Array<{ id: string; startDate: string; endDate: string; status: RequestStatus }> =
      await this.repo.manager.query(
        `SELECT r.id,
                to_char(r.start_date, 'YYYY-MM-DD') AS "startDate",
                to_char(r.end_date, 'YYYY-MM-DD') AS "endDate",
                r.status::text AS status
           FROM leave_requests r
          WHERE r.company_id = $1 AND r.user_id = $2
            AND r.status::text IN ('pending', 'approved')
            AND ${slotStartSql('r')} <= $4::int
            AND ${slotEndSql('r')} >= $3::int
            AND ($5::uuid IS NULL OR r.id <> $5::uuid)
          LIMIT 1`,
        [
          this.requireCompanyId(companyId),
          userId,
          slotStart(span.startDate, span.startHalfDay),
          slotEnd(span.endDate, span.endHalfDay),
          excludeId,
        ],
      );
    return rows[0] ?? null;
  }

  /** Demandes d'un type, pour une personne et une année (pour le calcul du solde). */
  spansOfType(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    year: number,
    statuses: readonly RequestStatus[],
    excludeId: string | null,
  ): Promise<LeaveSpanRow[]> {
    return this.repo.manager.query(
      `SELECT ${SPAN_COLUMNS}
         FROM leave_requests r
        WHERE r.company_id = $1 AND r.user_id = $2 AND r.leave_type_id = $3
          AND r.status::text = ANY($4::text[])
          AND r.start_date <= make_date($5::int, 12, 31)
          AND r.end_date >= make_date($5::int, 1, 1)
          AND ($6::uuid IS NULL OR r.id <> $6::uuid)`,
      [
        this.requireCompanyId(companyId),
        userId,
        leaveTypeId,
        [...statuses],
        year,
        excludeId,
      ],
    );
  }

  /** Toutes les demandes d'une personne pour une année, tous types confondus. */
  spansOfUser(
    companyId: string,
    userId: string,
    year: number,
    statuses: readonly RequestStatus[],
  ): Promise<LeaveSpanRow[]> {
    return this.repo.manager.query(
      `SELECT ${SPAN_COLUMNS}
         FROM leave_requests r
        WHERE r.company_id = $1 AND r.user_id = $2
          AND r.status::text = ANY($3::text[])
          AND r.start_date <= make_date($4::int, 12, 31)
          AND r.end_date >= make_date($4::int, 1, 1)`,
      [this.requireCompanyId(companyId), userId, [...statuses], year],
    );
  }

  /** Congés approuvés qui touchent [from, to] : calendrier d'absences. */
  approvedOverlapping(companyId: string, from: string, to: string): Promise<LeaveRequest[]> {
    const qb = this.scoped(companyId)
      .andWhere('lreq.status = :apprStatus', { apprStatus: RequestStatus.APPROVED })
      .andWhere('lreq.startDate <= :calTo', { calTo: to })
      .andWhere('lreq.endDate >= :calFrom', { calFrom: from });
    this.joinPeople(qb);
    return qb
      .orderBy('lreq.startDate', 'ASC')
      .addOrderBy('lreq.id', 'ASC')
      .limit(CALENDAR_LIMIT)
      .getMany();
  }

  /** Congés approuvés d'AUTRES personnes qui chevauchent cette demande : avertissement au valideur. */
  teamOverlaps(
    companyId: string,
    request: LeaveSpan & { userId: string },
  ): Promise<LeaveRequest[]> {
    const qb = this.scoped(companyId)
      .andWhere('lreq.status = :ovStatus', { ovStatus: RequestStatus.APPROVED })
      .andWhere('lreq.userId <> :ovUser', { ovUser: request.userId })
      .andWhere(`${slotStartSql('"lreq"')} <= :ovEnd`, {
        ovEnd: slotEnd(request.endDate, request.endHalfDay),
      })
      .andWhere(`${slotEndSql('"lreq"')} >= :ovStart`, {
        ovStart: slotStart(request.startDate, request.startHalfDay),
      });
    this.joinPeople(qb);
    return qb
      .orderBy('lreq.startDate', 'ASC')
      .addOrderBy('lreq.id', 'ASC')
      .limit(OVERLAPS_SHOWN)
      .getMany();
  }

  // ---------- Écritures ----------

  insertRequest(companyId: string, data: Record<string, unknown>): Promise<LeaveRequest> {
    return this.createOne(companyId, data as never);
  }

  changeRequest(
    companyId: string,
    id: string,
    changes: Record<string, unknown>,
  ): Promise<LeaveRequest> {
    return this.updateById(companyId, id, changes as unknown as UpdateChanges<LeaveRequest>);
  }

  // ---------- Outils internes ----------

  private restrictToOwner(qb: SelectQueryBuilder<LeaveRequest>, viewer: RequestViewer): void {
    if (!viewer.privileged) qb.andWhere('lreq.userId = :ownerId', { ownerId: viewer.id });
  }

  /** Demandeur et type de congé : id, nom et quelques champs d'affichage seulement. */
  private joinPeople(qb: SelectQueryBuilder<LeaveRequest>): void {
    qb.leftJoin('lreq.user', 'inc_user')
      .addSelect(['inc_user.id', 'inc_user.name', 'inc_user.avatarUrl', 'inc_user.jobTitle'])
      .leftJoin('lreq.leaveType', 'inc_type')
      .addSelect(['inc_type.id', 'inc_type.name']);
  }
}