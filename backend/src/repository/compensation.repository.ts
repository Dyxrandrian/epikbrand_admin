import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { PaginatedResult, toSkipTake } from '../dto/index.js';
import type { PaginationQueryDto } from '../dto/index.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { escapeLike, searchWords } from './search.js';
import { User } from '../entities/user.entity.js';

export interface EmployeeRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  matricule: string | null;
  baseSalary: number | null;
  dependentsCount: number;
}

interface RawEmployee {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  matricule: string | null;
  baseSalary: string | null;
  dependentsCount: number;
}

const COLUMNS = `u.id, u.name, u.avatar_url AS "avatarUrl", u.job_title AS "jobTitle",
       u.matricule, u.base_salary::text AS "baseSalary", u.dependents_count AS "dependentsCount"`;

const toRow = (raw: RawEmployee): EmployeeRow => ({
  ...raw,
  baseSalary: raw.baseSalary === null ? null : Number(raw.baseSalary),
});

/** Salaire de base et personnes à charge : lus et écrits ici seulement, toujours filtrés par entreprise. */
@Injectable()
export class CompensationRepository {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  private db(manager?: EntityManager): EntityManager {
    return manager ?? this.repo.manager;
  }

  async list(companyId: string, query: PaginationQueryDto): Promise<PaginatedResult<EmployeeRow>> {
    const params: unknown[] = [companyId];
    const conditions = ['u.company_id = $1', 'u.is_active = true'];
    searchWords(query.q).forEach((word) => {
      params.push(escapeLike(word));
      conditions.push(
        `f_unaccent(u.name) ILIKE '%' || f_unaccent(CAST($${params.length} AS text)) || '%'`,
      );
    });
    const where = conditions.join(' AND ');

    const { skip, take } = toSkipTake(query);
    const manager = this.db();
    const rows: RawEmployee[] = await manager.query(
      `SELECT ${COLUMNS} FROM users u WHERE ${where}
        ORDER BY u.name ASC, u.id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, take, skip],
    );
    const counted: Array<{ n: number }> = await manager.query(
      `SELECT COUNT(*)::int AS n FROM users u WHERE ${where}`,
      params,
    );
    return new PaginatedResult(rows.map(toRow), counted[0].n, query.page, query.per_page);
  }

  /** Utilisateur actif de l'entreprise, ou null. */
  async findActive(
    companyId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<EmployeeRow | null> {
    const rows: RawEmployee[] = await this.db(manager).query(
      `SELECT ${COLUMNS} FROM users u
        WHERE u.company_id = $1 AND u.id = $2 AND u.is_active = true`,
      [companyId, userId],
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** 404 si la personne n'existe pas dans l'entreprise (comptes désactivés compris). */
  async getOne(companyId: string, userId: string, manager?: EntityManager): Promise<EmployeeRow> {
    const rows: RawEmployee[] = await this.db(manager).query(
      `SELECT ${COLUMNS} FROM users u WHERE u.company_id = $1 AND u.id = $2`,
      [companyId, userId],
    );
    if (!rows[0]) throw new ResourceNotFoundException('Utilisateur');
    return toRow(rows[0]);
  }

  async activeEmployees(
    companyId: string,
    userIds: readonly string[] | undefined,
    manager?: EntityManager,
  ): Promise<EmployeeRow[]> {
    const rows: RawEmployee[] = await this.db(manager).query(
      `SELECT ${COLUMNS} FROM users u
        WHERE u.company_id = $1 AND u.is_active = true
          AND ($2::uuid[] IS NULL OR u.id = ANY($2::uuid[]))
        ORDER BY u.name ASC, u.id ASC`,
      [companyId, userIds ? [...userIds] : null],
    );
    return rows.map(toRow);
  }

  async set(
    companyId: string,
    userId: string,
    patch: { baseSalary?: number | null; dependentsCount?: number },
    manager?: EntityManager,
  ): Promise<void> {
    await this.db(manager).query(
      `UPDATE users
          SET base_salary = CASE WHEN $3::boolean THEN $4::numeric ELSE base_salary END,
              dependents_count = CASE WHEN $5::boolean THEN $6::int ELSE dependents_count END,
              updated_at = now()
        WHERE company_id = $1 AND id = $2`,
      [
        companyId,
        userId,
        patch.baseSalary !== undefined,
        patch.baseSalary ?? null,
        patch.dependentsCount !== undefined,
        patch.dependentsCount ?? 0,
      ],
    );
  }
}