import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientsSupport1795200000000 implements MigrationInterface {
  name = 'ClientsSupport1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Recherche (nom, contact, e-mail, téléphone) insensible à la casse et aux accents
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_search_clients" ON "clients" USING gin ((immutable_unaccent(lower("company_name" || ' ' || coalesce("contact_name", '') || ' ' || coalesce("email", '') || ' ' || coalesce("phone", '')))) gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_clients_company_name" ON "clients" ("company_id", "company_name")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_interactions_client_date" ON "interactions" ("client_id", "interaction_date" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_interactions_company_date" ON "interactions" ("company_id", "interaction_date" DESC)`,
    );
    // Clés étrangères utilisées par les filtres et la protection à la suppression
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_projects_client" ON "projects" ("client_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_invoices_client" ON "invoices" ("client_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_invoices_client"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_projects_client"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_interactions_company_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_interactions_client_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_clients_company_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_search_clients"`);
  }
}