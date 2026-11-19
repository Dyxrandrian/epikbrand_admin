import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { UpdateCompanySettingsDto } from '../../dto/company/update-company-settings.dto.js';
import type { UpdateCompanyDto } from '../../dto/company/update-company.dto.js';
import { mapDto } from '../../dto/map-dto.js';
import type { Company } from '../../entities/company.entity.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  toCompanyProfile,
  toCompanySettings,
  toCompanyUsage,
} from '../../mapper/company.mapper.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges } from '../audit/audit-changes.js';
import {
  COMPANY_AUDIT_FIELDS,
  COMPANY_SETTINGS_AUDIT_FIELDS,
} from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';

const PROFILE_MAP = {
  name: 'name',
  bio: 'bio',
  website_url: 'websiteUrl',
  address: 'address',
  phone: 'phone',
  tax_info: 'taxInfo',
  nif: 'nif',
  stat: 'stat',
  rcs: 'rcs',
} as const;

const SETTINGS_MAP = {
  default_currency: 'defaultCurrency',
  default_vat_rate: 'defaultVatRate',
  timezone: 'timezone',
} as const;

@Injectable()
export class CompanyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditService,
  ) {}

  async getProfile(companyId: string) {
    return toCompanyProfile(await this.companies.getById(companyId));
  }

  async getSettings(companyId: string) {
    return toCompanySettings(await this.companies.getById(companyId));
  }

  updateProfile(admin: AuthenticatedUser, dto: UpdateCompanyDto) {
    return this.applyUpdate(
      admin,
      mapDto(dto, PROFILE_MAP),
      COMPANY_AUDIT_FIELDS,
      toCompanyProfile,
    );
  }

  updateSettings(admin: AuthenticatedUser, dto: UpdateCompanySettingsDto) {
    return this.applyUpdate(
      admin,
      mapDto(dto, SETTINGS_MAP),
      COMPANY_SETTINGS_AUDIT_FIELDS,
      toCompanySettings,
    );
  }

  async getUsage(companyId: string) {
    const [company, usage] = await Promise.all([
      this.companies.getById(companyId),
      this.companies.usage(companyId),
    ]);
    return toCompanyUsage(usage, company.storageQuotaBytes);
  }

  private async applyUpdate<R>(
    admin: AuthenticatedUser,
    changes: Record<string, unknown>,
    auditFields: readonly string[],
    present: (company: Company) => R,
  ): Promise<R> {
    if (Object.keys(changes).length === 0) {
      return present(await this.companies.getById(admin.companyId));
    }

    return this.dataSource.transaction(async (manager) => {
      const before = await this.companies.getById(admin.companyId, manager);
      const after = await this.companies.update(admin.companyId, changes, manager);

      const diff = diffChanges(before, after, auditFields);
      if (diff) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.COMPANY,
            entityId: admin.companyId,
            companyId: admin.companyId,
            userId: admin.id,
            changes: diff,
          },
          manager,
        );
      }
      return present(after);
    });
  }
}