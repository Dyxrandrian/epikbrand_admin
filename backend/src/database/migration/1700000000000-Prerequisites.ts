import { MigrationInterface, QueryRunner } from 'typeorm';

export class Prerequisites1700000000000 implements MigrationInterface {
  name = 'Prerequisites1700000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    await q.query(`CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text AS $$
      SELECT public.unaccent('public.unaccent', $1) $$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT`);
  }

  async down(): Promise<void> {}
}
