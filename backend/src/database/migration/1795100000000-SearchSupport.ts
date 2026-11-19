import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SearchSupport1795100000000 implements MigrationInterface {
  name = 'SearchSupport1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "unaccent"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION immutable_unaccent(text)
      RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
      $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_search_users" ON "users" USING gin ((immutable_unaccent(lower("name" || ' ' || "email"::text || ' ' || coalesce("job_title", '')))) gin_trgm_ops)`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_search_users_full" ON "users" USING gin ((immutable_unaccent(lower("name" || ' ' || "email"::text || ' ' || coalesce("job_title", '') || ' ' || coalesce("matricule", '')))) gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_search_users_full"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_search_users"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "public"."immutable_unaccent"(text)`);
  }
}
