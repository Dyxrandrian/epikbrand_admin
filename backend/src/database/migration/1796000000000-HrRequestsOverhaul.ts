import type { MigrationInterface, QueryRunner } from 'typeorm';

// Demi-journées depuis le 2000-01-01 : même formule que le code (leave-calendar.ts)
const SLOT_START = `(("start_date" - DATE '2000-01-01') * 2 + CASE WHEN "start_half_day" THEN 1 ELSE 0 END)`;
const SLOT_END = `(("end_date" - DATE '2000-01-01') * 2 + CASE WHEN "end_half_day" THEN 0 ELSE 1 END)`;

export class HrRequestsOverhaul1796000000000 implements MigrationInterface {
  name = 'HrRequestsOverhaul1796000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "btree_gist"`);

    // ---------- Congés ----------
    await q.query(`ALTER TABLE "leave_requests"
      ADD COLUMN "start_half_day" boolean NOT NULL DEFAULT false,
      ADD COLUMN "end_half_day" boolean NOT NULL DEFAULT false`);

    await q.query(`ALTER TABLE "leave_requests"
      ADD CONSTRAINT "chk_leave_slots" CHECK (${SLOT_START} <= ${SLOT_END}),
      ADD CONSTRAINT "chk_leave_days" CHECK ("days_count" > 0),
      ADD CONSTRAINT "chk_leave_review" CHECK (
        ("status" = 'pending' AND "reviewed_at" IS NULL)
        OR ("status" IN ('approved', 'rejected') AND "reviewed_at" IS NOT NULL)
        OR "status" = 'cancelled')`);

    // Deux demandes en attente ou approuvées d'une même personne ne peuvent pas se chevaucher
    await q.query(`ALTER TABLE "leave_requests" ADD CONSTRAINT "excl_leave_no_overlap"
      EXCLUDE USING gist ("user_id" WITH =, int4range(${SLOT_START}, ${SLOT_END}, '[]') WITH &&)
      WHERE ("status" IN ('pending', 'approved'))`);

    await q.query(`CREATE INDEX "idx_leave_company_status_start" ON "leave_requests" ("company_id", "status", "start_date")`);
    await q.query(`CREATE INDEX "idx_leave_user_created" ON "leave_requests" ("user_id", "created_at" DESC)`);

    // ---------- Soldes ----------
    await q.query(`ALTER TABLE "leave_balances"
      ADD CONSTRAINT "chk_leave_balance_allowance" CHECK ("allowance_days" >= 0),
      ADD CONSTRAINT "chk_leave_balance_year" CHECK ("year" BETWEEN 2000 AND 2100)`);
    await q.query(`CREATE INDEX "idx_leave_balances_company_year" ON "leave_balances" ("company_id", "year")`);

    // ---------- Formations ----------
    await q.query(`ALTER TABLE "training_requests" ADD CONSTRAINT "chk_training_review" CHECK (
        ("status" = 'pending' AND "reviewed_at" IS NULL)
        OR ("status" IN ('approved', 'rejected') AND "reviewed_at" IS NOT NULL)
        OR "status" = 'cancelled')`);
    await q.query(`CREATE INDEX "idx_training_company_status" ON "training_requests" ("company_id", "status", "created_at" DESC)`);
    await q.query(`CREATE INDEX "idx_training_user_created" ON "training_requests" ("user_id", "created_at" DESC)`);
    await q.query(`CREATE INDEX "idx_training_approved_review" ON "training_requests" ("company_id", "reviewed_at") WHERE "status" = 'approved'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."idx_training_approved_review"`);
    await q.query(`DROP INDEX "public"."idx_training_user_created"`);
    await q.query(`DROP INDEX "public"."idx_training_company_status"`);
    await q.query(`ALTER TABLE "training_requests" DROP CONSTRAINT "chk_training_review"`);

    await q.query(`DROP INDEX "public"."idx_leave_balances_company_year"`);
    await q.query(`ALTER TABLE "leave_balances"
      DROP CONSTRAINT "chk_leave_balance_year",
      DROP CONSTRAINT "chk_leave_balance_allowance"`);

    await q.query(`DROP INDEX "public"."idx_leave_user_created"`);
    await q.query(`DROP INDEX "public"."idx_leave_company_status_start"`);
    await q.query(`ALTER TABLE "leave_requests" DROP CONSTRAINT "excl_leave_no_overlap"`);
    await q.query(`ALTER TABLE "leave_requests"
      DROP CONSTRAINT "chk_leave_review",
      DROP CONSTRAINT "chk_leave_days",
      DROP CONSTRAINT "chk_leave_slots"`);
    await q.query(`ALTER TABLE "leave_requests" DROP COLUMN "end_half_day", DROP COLUMN "start_half_day"`);
  }
}