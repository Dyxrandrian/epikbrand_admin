export const USER_AUDIT_FIELDS = [
  'name',
  'email',
  'role',
  'isActive',
  'isVerified',
  'jobTitle',
  'matricule',
] as const;

// `bio` est volontairement absente : texte long, tronqué par l'audit, non sensible.
export const COMPANY_AUDIT_FIELDS = [
  'name',
  'websiteUrl',
  'address',
  'phone',
  'taxInfo',
  'nif',
  'stat',
  'rcs',
] as const;

export const COMPANY_SETTINGS_AUDIT_FIELDS = [
  'defaultCurrency',
  'defaultVatRate',
  'timezone',
] as const;

export const LEAVE_TYPE_AUDIT_FIELDS = ['name', 'defaultAnnualDays'] as const;
export const ARTICLE_CATEGORY_AUDIT_FIELDS = ['name', 'slug'] as const;
export const ARTICLE_SECTION_AUDIT_FIELDS = ['name', 'slug'] as const;
export const STRUCTURE_ELEMENT_TYPE_AUDIT_FIELDS = ['name', 'slug'] as const;
export const EXPENSE_CATEGORY_AUDIT_FIELDS = ['name', 'description'] as const;
export const LABEL_AUDIT_FIELDS = ['name', 'color'] as const;

export const CLIENT_AUDIT_FIELDS = [
  'companyName',
  'contactName',
  'email',
  'phone',
  'address',
] as const;