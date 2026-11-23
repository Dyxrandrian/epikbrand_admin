import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Company } from '../entities/company.entity.js';
import { ResourceNotFoundException } from '../exceptions/index.js';

export interface CompanyUsage {
  activeUsers: number;
  totalUsers: number;
  storageUsedBytes: number;
}

type CompanyChanges = Parameters<Repository<Company>['update']>[1];

@Injectable()
export class CompanyRepository {
  constructor(@InjectRepository(Company) private readonly repo: Repository<Company>) { }

  async getById(companyId: string, manager?: EntityManager): Promise<Company> {
    const company = await this.repoFor(manager).findOne({
      where: { id: this.requireCompanyId(companyId) },
    });
    if (!company) throw new ResourceNotFoundException('Entreprise');
    return company;
  }

  async update(
    companyId: string,
    changes: Record<string, unknown>,
    manager?: EntityManager,
  ): Promise<Company> {
    const safe = { ...changes };
    // Jamais modifiables par cette voie
    for (const field of ['id', 'createdAt', 'storageQuotaBytes']) delete safe[field];

    if (Object.keys(safe).length > 0) {
      const result = await this.repoFor(manager).update(
        { id: this.requireCompanyId(companyId) },
        safe as CompanyChanges,
      );
      if (!result.affected) throw new ResourceNotFoundException('Entreprise');
    }
    return this.getById(companyId, manager);
  }

  async usage(companyId: string): Promise<CompanyUsage> {
    const rows: Array<{ active_users: number; total_users: number; storage_used: string }> =
      await this.repo.manager.query(
        `SELECT
           (SELECT COUNT(*)::int FROM users WHERE company_id = $1 AND is_active = true) AS active_users,
           (SELECT COUNT(*)::int FROM users WHERE company_id = $1) AS total_users,
           (SELECT COALESCE(SUM(file_size), 0)::text FROM media_attachments WHERE company_id = $1) AS storage_used`,
        [this.requireCompanyId(companyId)],
      );
    const row = rows[0];
    return {
      activeUsers: row.active_users,
      totalUsers: row.total_users,
      storageUsedBytes: Number(row.storage_used),
    };
  }

  private repoFor(manager?: EntityManager): Repository<Company> {
    return manager ? manager.getRepository(Company) : this.repo;
  }

  private requireCompanyId(companyId: string): string {
    if (typeof companyId !== 'string' || companyId.length === 0) {
      throw new Error('companyId obligatoire.');
    }
    return companyId;
  }

  /**
 * Toutes les entreprises : réservé aux tâches planifiées, qui n'ont pas de requête pour leur
 * fournir un company_id. Chaque tâche travaille ensuite entreprise par entreprise.
 */
  async listForJobs(): Promise<Array<{ id: string; timezone: string; defaultCurrency: string }>> {
    const companies = await this.repo.find({
      select: { id: true, timezone: true, defaultCurrency: true },
      order: { createdAt: 'ASC' },
    });
    return companies.map((company) => ({
      id: company.id,
      timezone: company.timezone,
      defaultCurrency: company.defaultCurrency,
    }));
  }
}