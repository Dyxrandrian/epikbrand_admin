import type { EntityManager } from 'typeorm';

const LEAVE_TYPES: Array<{ name: string; days: number | null }> = [
  { name: 'Congé annuel', days: 30 },
  { name: 'Congé maladie', days: null },
  { name: 'Congé sans solde', days: null },
  { name: 'Congé maternité', days: 98 },
];

const EXPENSE_CATEGORIES = [
  'Loyer et charges',
  'Logiciels et abonnements',
  'Matériel',
  'Déplacements',
  'Marketing',
  'Télécommunications',
  'Impôts et taxes',
  'Autres',
];

const ARTICLE_SECTIONS = [
  { name: 'Général', slug: 'general' },
  { name: 'Procédures', slug: 'procedures' },
  { name: 'Ressources', slug: 'ressources' },
];

const STRUCTURE_TYPES = [
  { name: 'Département', slug: 'departement' },
  { name: 'Valeur', slug: 'valeur' },
  { name: 'Outil', slug: 'outil' },
  { name: 'Processus', slug: 'processus' },
  { name: 'Procédure', slug: 'procedure' },
];

const INVOICE_SEQUENCES = [
  { type: 'invoice', prefix: 'FAC' },
  { type: 'quote', prefix: 'DEV' },
  { type: 'credit_note', prefix: 'AVO' },
];

export async function seedCompanyDefaults(
  manager: EntityManager,
  companyId: string,
): Promise<void> {
  for (const leave of LEAVE_TYPES) {
    await manager.query(
      'INSERT INTO leave_types (company_id, name, default_annual_days) VALUES ($1, $2, $3)',
      [companyId, leave.name, leave.days],
    );
  }

  for (const name of EXPENSE_CATEGORIES) {
    await manager.query(
      'INSERT INTO expense_categories (company_id, name) VALUES ($1, $2)',
      [companyId, name],
    );
  }

  for (const section of ARTICLE_SECTIONS) {
    await manager.query(
      'INSERT INTO article_sections (company_id, name, slug) VALUES ($1, $2, $3)',
      [companyId, section.name, section.slug],
    );
  }

  for (const type of STRUCTURE_TYPES) {
    await manager.query(
      'INSERT INTO structure_element_types (company_id, name, slug) VALUES ($1, $2, $3)',
      [companyId, type.name, type.slug],
    );
  }

  const year = new Date().getFullYear();
  for (const sequence of INVOICE_SEQUENCES) {
    await manager.query(
      'INSERT INTO invoice_sequences (company_id, type, year, prefix, last_number) VALUES ($1, $2, $3, $4, 0)',
      [companyId, sequence.type, year, sequence.prefix],
    );
  }
}