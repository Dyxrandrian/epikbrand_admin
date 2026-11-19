import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TasksSupport1795400000000 implements MigrationInterface {
  name = 'TasksSupport1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_tasks_company_status" ON "tasks" ("company_id", "status") WHERE "archived_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tasks_company_end" ON "tasks" ("company_id", "end_date") WHERE "archived_at" IS NULL AND "end_date" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tasks_parent" ON "tasks" ("parent_task_id") WHERE "parent_task_id" IS NOT NULL`,
    );
    // La clé primaire de task_labels commence par task_id : il manque l'accès par étiquette
    await queryRunner.query(`CREATE INDEX "idx_task_labels_label" ON "task_labels" ("label_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_task_comments_task" ON "task_comments" ("task_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_task_comments_task"`);
    await queryRunner.query(`DROP INDEX "public"."idx_task_labels_label"`);
    await queryRunner.query(`DROP INDEX "public"."idx_tasks_parent"`);
    await queryRunner.query(`DROP INDEX "public"."idx_tasks_company_end"`);
    await queryRunner.query(`DROP INDEX "public"."idx_tasks_company_status"`);
  }
}