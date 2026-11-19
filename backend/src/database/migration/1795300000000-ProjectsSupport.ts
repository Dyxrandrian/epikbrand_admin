import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectsSupport1795300000000 implements MigrationInterface {
  name = 'ProjectsSupport1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_projects_company_status" ON "projects" ("company_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_projects_deadline" ON "projects" ("company_id", "deadline")`,
    );
    // Progression, équipe et participation : tâches actives d'un projet
    await queryRunner.query(
      `CREATE INDEX "idx_tasks_project" ON "tasks" ("project_id", "status") WHERE "archived_at" IS NULL`,
    );
    // « Mes projets » : recherche par utilisateur assigné
    await queryRunner.query(
      `CREATE INDEX "idx_task_assignees_user" ON "task_assignees" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_task_assignees_user"`);
    await queryRunner.query(`DROP INDEX "public"."idx_tasks_project"`);
    await queryRunner.query(`DROP INDEX "public"."idx_projects_deadline"`);
    await queryRunner.query(`DROP INDEX "public"."idx_projects_company_status"`);
  }
}