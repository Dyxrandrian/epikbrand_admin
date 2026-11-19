import type { Company } from '../entities/company.entity.js';
import type { CompanyUsage } from '../repository/company.repository.js';

export function toCompanyProfile(company: Company) {
  return {
    id: company.id,
    name: company.name,
    logo_url: company.logoUrl,
    cover_url: company.coverUrl,
    bio: company.bio,
    website_url: company.websiteUrl,
    address: company.address,
    phone: company.phone,
    tax_info: company.taxInfo,
    nif: company.nif,
    stat: company.stat,
    rcs: company.rcs,
    created_at: company.createdAt,
  };
}

export function toCompanySettings(company: Company) {
  return {
    default_currency: company.defaultCurrency,
    default_vat_rate: Number(company.defaultVatRate),
    timezone: company.timezone,
  };
}

export function toCompanyUsage(usage: CompanyUsage, quotaBytes: number) {
  const quota = Number(quotaBytes);
  return {
    active_users: usage.activeUsers,
    total_users: usage.totalUsers,
    storage_used_bytes: usage.storageUsedBytes,
    storage_quota_bytes: quota,
    storage_used_percent:
      quota > 0 ? Math.round((usage.storageUsedBytes / quota) * 1000) / 10 : null,
  };
}