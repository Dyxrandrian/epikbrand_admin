import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SortOrder } from '../dto/index.js';
import { LeaveBalance } from '../entities/leave-balance.entity.js';
import { InvalidReferenceException, ResourceNotFoundException } from '../exceptions/index.js';
import { TenantRepository } from './tenant.repository.js';

export interface LeaveTypeQuota {
  id: string;
  name: string;
  /** null : ce type n'a pas de quota annuel. */
  defaultAnnualDays: number | null;
}

@Injectable()
export class LeaveBalanceRepository extends TenantRepository<LeaveBalance> {
  protected readonly alias = 'lbal';
  protected readonly label = 'Solde de congés';
  protected readonly sortableFields = { year: 'year' };
  protected readonly defaultSort: SortOrder = { year: 'DESC' };

  constructor(@InjectRepository(LeaveBalance) repo: Repository<LeaveBalance>) {
    super(repo);
  }

  /**
   * Quota de cette personne pour ce type et cette année ; la ligne est créée avec le quota par
   * défaut du type si elle n'existe pas encore. À appeler sous le verrou de la personne
   * (LeaveRequestRepository.lockUser).
   */
  async ensureAllowance(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    year: number,
    defaultAllowance: number,
  ): Promise<number> {
    const company = this.requireCompanyId(companyId);
    await this.repo.manager.query(
      `INSERT INTO leave_balances (company_id, user_id, leave_type_id, year, allowance_days)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, leave_type_id, year) DO NOTHING`,
      [company, userId, leaveTypeId, year, defaultAllowance],
    );
    const rows: Array<{ allowance: string }> = await this.repo.manager.query(
      `SELECT allowance_days::text AS allowance
         FROM leave_balances
        WHERE company_id = $1 AND user_id = $2 AND leave_type_id = $3 AND year = $4`,
      [company, userId, leaveTypeId, year],
    );
    return Number(rows[0].allowance);
  }

  /** Quotas déjà enregistrés pour une personne et une année : type de congé vers quota. */
  async allowancesOf(
    companyId: string,
    userId: string,
    year: number,
  ): Promise<Map<string, number>> {
    const rows: Array<{ typeId: string; allowance: string }> = await this.repo.manager.query(
      `SELECT leave_type_id AS "typeId", allowance_days::text AS allowance
         FROM leave_balances
        WHERE company_id = $1 AND user_id = $2 AND year = $3`,
      [this.requireCompanyId(companyId), userId, year],
    );
    return new Map(rows.map((row) => [row.typeId, Number(row.allowance)]));
  }

  async typesOf(companyId: string): Promise<LeaveTypeQuota[]> {
    const rows: Array<{ id: string; name: string; quota: string | null }> =
      await this.repo.manager.query(
        `SELECT id, name, default_annual_days::text AS quota
           FROM leave_types
          WHERE company_id = $1
          ORDER BY name ASC, id ASC`,
        [this.requireCompanyId(companyId)],
      );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      defaultAnnualDays: row.quota === null ? null : Number(row.quota),
    }));
  }

  /** Fixe le quota ; renvoie l'identifiant de la ligne et l'ancien quota (null si elle n'existait pas). */
  async upsertAllowance(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    year: number,
    allowance: number,
  ): Promise<{ id: string; previous: number | null }> {
    const rows: Array<{ id: string; previous: string | null }> = await this.repo.manager.query(
      `WITH previous AS (
         SELECT allowance_days FROM leave_balances
          WHERE company_id = $1 AND user_id = $2 AND leave_type_id = $3 AND year = $4
       )
       INSERT INTO leave_balances (company_id, user_id, leave_type_id, year, allowance_days)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, leave_type_id, year)
       DO UPDATE SET allowance_days = EXCLUDED.allowance_days
       RETURNING id, (SELECT allowance_days::text FROM previous) AS previous`,
      [this.requireCompanyId(companyId), userId, leaveTypeId, year, allowance],
    );
    return {
      id: rows[0].id,
      previous: rows[0].previous === null ? null : Number(rows[0].previous),
    };
  }

  /** 404 si la personne n'existe pas dans l'entreprise (comptes désactivés compris). */
  async assertUserInCompany(companyId: string, userId: string): Promise<void> {
    const rows: Array<{ ok: boolean }> = await this.repo.manager.query(
      `SELECT EXISTS (SELECT 1 FROM users WHERE company_id = $1 AND id = $2) AS ok`,
      [this.requireCompanyId(companyId), userId],
    );
    if (!rows[0].ok) throw new ResourceNotFoundException('Utilisateur');
  }

  /** 422 si l'identifiant n'est pas un utilisateur actif de l'entreprise. */
  async assertActiveUser(companyId: string, userId: string, field: string): Promise<void> {
    const rows: Array<{ ok: boolean }> = await this.repo.manager.query(
      `SELECT EXISTS (
         SELECT 1 FROM users WHERE company_id = $1 AND id = $2 AND is_active = true
       ) AS ok`,
      [this.requireCompanyId(companyId), userId],
    );
    if (!rows[0].ok) throw new InvalidReferenceException(field, 'Utilisateur');
  }
}