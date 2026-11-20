import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FilesSupport1795600000000 implements MigrationInterface {
  name = 'FilesSupport1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_media_company_created" ON "media_attachments" ("company_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_media_task" ON "media_attachments" ("task_id") WHERE "task_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_media_project" ON "media_attachments" ("project_id") WHERE "project_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_media_article" ON "media_attachments" ("article_id") WHERE "article_id" IS NOT NULL`,
    );
    // Remplacement d'un avatar, reçus d'un utilisateur, suppression d'un compte
    await queryRunner.query(
      `CREATE INDEX "idx_media_uploader" ON "media_attachments" ("uploaded_by") WHERE "uploaded_by" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_media_uploader"`);
    await queryRunner.query(`DROP INDEX "public"."idx_media_article"`);
    await queryRunner.query(`DROP INDEX "public"."idx_media_project"`);
    await queryRunner.query(`DROP INDEX "public"."idx_media_task"`);
    await queryRunner.query(`DROP INDEX "public"."idx_media_company_created"`);
  }
}