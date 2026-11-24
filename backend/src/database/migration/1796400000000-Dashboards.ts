import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Dashboards1796400000000 implements MigrationInterface {
  name = 'Dashboards1796400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX "idx_tasks_completed" ON "tasks" ("company_id", "completed_at") WHERE "completed_at" IS NOT NULL AND "archived_at" IS NULL`);
    await q.query(`CREATE INDEX "idx_invoices_company_due" ON "invoices" ("company_id", "due_date") WHERE "type" = 'invoice' AND "due_date" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_invoices_quote_accepted" ON "invoices" ("company_id", "accepted_at") WHERE "accepted_at" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_expenses_paid" ON "expenses" ("company_id", "paid_at") WHERE "status" = 'paid'`);
    await q.query(`CREATE INDEX "idx_salaries_paid" ON "salaries" ("company_id", "payment_date") WHERE "status" = 'paid'`);
    await q.query(`CREATE INDEX "idx_clients_company_created" ON "clients" ("company_id", "created_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."idx_clients_company_created"`);
    await q.query(`DROP INDEX "public"."idx_salaries_paid"`);
    await q.query(`DROP INDEX "public"."idx_expenses_paid"`);
    await q.query(`DROP INDEX "public"."idx_invoices_quote_accepted"`);
    await q.query(`DROP INDEX "public"."idx_invoices_company_due"`);
    await q.query(`DROP INDEX "public"."idx_tasks_completed"`);
  }
}