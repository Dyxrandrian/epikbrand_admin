import { MigrationInterface, QueryRunner } from 'typeorm';

/** À renommer avec un timestamp SUPÉRIEUR à celui de la migration générée (ex. 9999999999999-PostSchema.ts). */
export class PostSchema9999999999999 implements MigrationInterface {
  name = 'PostSchema9999999999999';

  private readonly indexes: [string, string, string][] = [
    ['idx_search_clients', 'clients', 'f_unaccent(company_name) gin_trgm_ops'],
    ['idx_search_projects', 'projects', 'f_unaccent(title) gin_trgm_ops'],
    ['idx_search_tasks', 'tasks', 'f_unaccent(title) gin_trgm_ops'],
    ['idx_search_articles', 'agency_articles', 'f_unaccent(title) gin_trgm_ops'],
    ['idx_search_expenses', 'expenses', 'f_unaccent(title) gin_trgm_ops'],
    ['idx_search_users', 'users', 'f_unaccent(name) gin_trgm_ops'],
    ['idx_search_invoice_number', 'invoices', 'invoice_number gin_trgm_ops'],
  ];

  async up(q: QueryRunner): Promise<void> {
    for (const [name, table, expr] of this.indexes) {
      await q.query(`CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" USING gin (${expr})`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    for (const [name] of this.indexes) await q.query(`DROP INDEX IF EXISTS "${name}"`);
  }
}
