import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IdempotencyKeys1795800000000 implements MigrationInterface {
  name = 'IdempotencyKeys1795800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "idempotency_keys" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "company_id" uuid NOT NULL,
      "user_id" uuid NOT NULL,
      "key" character varying(255) NOT NULL,
      "request_hash" character(64) NOT NULL,
      "status" character varying(15) NOT NULL DEFAULT 'in_progress',
      "response_body" jsonb,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("id"),
      CONSTRAINT "uq_idempotency_scope" UNIQUE ("company_id", "user_id", "key"),
      CONSTRAINT "chk_idempotency_status" CHECK ("status" IN ('in_progress', 'completed')),
      CONSTRAINT "FK_idempotency_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_idempotency_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)`);
    await q.query(`CREATE INDEX "idx_idempotency_expires" ON "idempotency_keys" ("expires_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."idx_idempotency_expires"`);
    await q.query(`DROP TABLE "idempotency_keys"`);
  }
}