import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScheduledJobs1796200000000 implements MigrationInterface {
  name = 'ScheduledJobs1796200000000';

  public async up(q: QueryRunner): Promise<void> {
    // ---------- Historique et verrou des exécutions ----------
    await q.query(`CREATE TABLE "scheduled_job_runs" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "job_name" character varying(60) NOT NULL,
      "company_id" uuid,
      "scope" character varying(40) NOT NULL,
      "run_key" character varying(80) NOT NULL,
      "status" character varying(10) NOT NULL DEFAULT 'running',
      "triggered_by" character varying(10) NOT NULL DEFAULT 'schedule',
      "attempts" integer NOT NULL DEFAULT 1,
      "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "finished_at" TIMESTAMP WITH TIME ZONE,
      "result" jsonb,
      "error" text,
      CONSTRAINT "PK_scheduled_job_runs" PRIMARY KEY ("id"),
      CONSTRAINT "uq_job_run_scope" UNIQUE ("job_name", "scope", "run_key"),
      CONSTRAINT "chk_job_run_status" CHECK ("status" IN ('running', 'succeeded', 'failed')),
      CONSTRAINT "chk_job_run_trigger" CHECK ("triggered_by" IN ('schedule', 'manual')),
      CONSTRAINT "FK_job_runs_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE)`);
    await q.query(`CREATE INDEX "idx_job_runs_company" ON "scheduled_job_runs" ("company_id", "job_name", "started_at" DESC)`);
    await q.query(`CREATE INDEX "idx_job_runs_started" ON "scheduled_job_runs" ("started_at")`);

    // ---------- Dépenses récurrentes : une seule occurrence par modèle et par date ----------
    await q.query(`CREATE UNIQUE INDEX "uq_expenses_occurrence" ON "expenses" ("parent_expense_id", "expense_date") WHERE "parent_expense_id" IS NOT NULL`);

    // ---------- Corbeille : candidats à la purge ----------
    await q.query(`CREATE INDEX "idx_clients_archived" ON "clients" ("company_id", "archived_at") WHERE "archived_at" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_projects_archived" ON "projects" ("company_id", "archived_at") WHERE "archived_at" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_tasks_archived" ON "tasks" ("company_id", "archived_at") WHERE "archived_at" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_articles_archived" ON "agency_articles" ("company_id", "archived_at") WHERE "archived_at" IS NOT NULL`);

    // ---------- Autres purges ----------
    await q.query(`CREATE INDEX "idx_notifications_read_old" ON "notifications" ("company_id", "created_at") WHERE "is_read" = true`);
    await q.query(`CREATE INDEX "idx_media_receipts" ON "media_attachments" ("company_id", "created_at") WHERE "purpose" = 'receipt'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."idx_media_receipts"`);
    await q.query(`DROP INDEX "public"."idx_notifications_read_old"`);
    await q.query(`DROP INDEX "public"."idx_articles_archived"`);
    await q.query(`DROP INDEX "public"."idx_tasks_archived"`);
    await q.query(`DROP INDEX "public"."idx_projects_archived"`);
    await q.query(`DROP INDEX "public"."idx_clients_archived"`);
    await q.query(`DROP INDEX "public"."uq_expenses_occurrence"`);
    await q.query(`DROP INDEX "public"."idx_job_runs_started"`);
    await q.query(`DROP INDEX "public"."idx_job_runs_company"`);
    await q.query(`DROP TABLE "scheduled_job_runs"`);
  }
}