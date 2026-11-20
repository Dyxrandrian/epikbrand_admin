import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpensesOverhaul1795900000000 implements MigrationInterface {
  name = 'ExpensesOverhaul1795900000000';

  public async up(q: QueryRunner): Promise<void> {
    // ---------- Validation des notes de frais ----------
    await q.query(`ALTER TABLE "expenses"
      ADD COLUMN "validated_by" uuid,
      ADD COLUMN "validated_at" TIMESTAMP WITH TIME ZONE`);
    await q.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_expenses_validated_by"
      FOREIGN KEY ("validated_by") REFERENCES "users"("id") ON DELETE SET NULL`);
    await q.query(`UPDATE "expenses" SET "validated_at" = "created_at" WHERE "status" = 'paid'`);

    // ---------- Ordre des lignes ----------
    await q.query(`ALTER TABLE "expense_items" ADD COLUMN "position" integer NOT NULL DEFAULT 0`);
    await q.query(`WITH ranked AS (
         SELECT "id", ROW_NUMBER() OVER (PARTITION BY "expense_id" ORDER BY "id") - 1 AS pos
           FROM "expense_items")
       UPDATE "expense_items" it SET "position" = r.pos FROM ranked r WHERE it."id" = r."id"`);

    // ---------- Contraintes : lignes ----------
    await q.query(`ALTER TABLE "expense_items"
      ADD CONSTRAINT "chk_expense_item_quantity" CHECK ("quantity" > 0),
      ADD CONSTRAINT "chk_expense_item_price" CHECK ("unit_price" >= 0),
      ADD CONSTRAINT "chk_expense_item_position" CHECK ("position" >= 0),
      ADD CONSTRAINT "uq_expense_item_position" UNIQUE ("expense_id", "position")`);

    // ---------- Contraintes : dépenses ----------
    await q.query(`ALTER TABLE "expenses"
      ADD CONSTRAINT "chk_expense_nonnegative" CHECK ("amount_ht" >= 0 AND "vat_amount" >= 0),
      ADD CONSTRAINT "chk_expense_due_date" CHECK ("due_date" IS NULL OR "due_date" >= "expense_date"),
      ADD CONSTRAINT "chk_expense_payment" CHECK (
        ("status" = 'paid' AND "paid_at" IS NOT NULL AND "payment_method" IS NOT NULL)
        OR ("status" <> 'paid' AND "paid_at" IS NULL AND "payment_method" IS NULL)),
      ADD CONSTRAINT "chk_expense_recurrence_value" CHECK ("is_recurring" = true OR "recurrence" IS NULL),
      ADD CONSTRAINT "chk_expense_child_not_model" CHECK ("parent_expense_id" IS NULL OR "is_recurring" = false)`);

    // ---------- Index ----------
    await q.query(`CREATE INDEX "idx_expenses_company_date" ON "expenses" ("company_id", "expense_date" DESC)`);
    await q.query(`CREATE INDEX "idx_expenses_company_status" ON "expenses" ("company_id", "status")`);
    await q.query(`CREATE INDEX "idx_expenses_due_open" ON "expenses" ("company_id", "due_date") WHERE "status" = 'pending' AND "due_date" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_expenses_project" ON "expenses" ("project_id") WHERE "project_id" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_expenses_category" ON "expenses" ("category_id") WHERE "category_id" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_expenses_user" ON "expenses" ("user_id", "expense_date" DESC) WHERE "user_id" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_expenses_parent" ON "expenses" ("parent_expense_id") WHERE "parent_expense_id" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_expenses_recurring" ON "expenses" ("company_id") WHERE "is_recurring" = true`);
    // Un justificatif ne peut être rattaché qu'à une seule dépense
    await q.query(`CREATE UNIQUE INDEX "uq_expenses_receipt" ON "expenses" ("company_id", "receipt_url") WHERE "receipt_url" IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."uq_expenses_receipt"`);
    await q.query(`DROP INDEX "public"."idx_expenses_recurring"`);
    await q.query(`DROP INDEX "public"."idx_expenses_parent"`);
    await q.query(`DROP INDEX "public"."idx_expenses_user"`);
    await q.query(`DROP INDEX "public"."idx_expenses_category"`);
    await q.query(`DROP INDEX "public"."idx_expenses_project"`);
    await q.query(`DROP INDEX "public"."idx_expenses_due_open"`);
    await q.query(`DROP INDEX "public"."idx_expenses_company_status"`);
    await q.query(`DROP INDEX "public"."idx_expenses_company_date"`);

    await q.query(`ALTER TABLE "expenses"
      DROP CONSTRAINT "chk_expense_child_not_model",
      DROP CONSTRAINT "chk_expense_recurrence_value",
      DROP CONSTRAINT "chk_expense_payment",
      DROP CONSTRAINT "chk_expense_due_date",
      DROP CONSTRAINT "chk_expense_nonnegative"`);
    await q.query(`ALTER TABLE "expense_items"
      DROP CONSTRAINT "uq_expense_item_position",
      DROP CONSTRAINT "chk_expense_item_position",
      DROP CONSTRAINT "chk_expense_item_price",
      DROP CONSTRAINT "chk_expense_item_quantity"`);
    await q.query(`ALTER TABLE "expense_items" DROP COLUMN "position"`);
    await q.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_expenses_validated_by"`);
    await q.query(`ALTER TABLE "expenses" DROP COLUMN "validated_at", DROP COLUMN "validated_by"`);
  }
}