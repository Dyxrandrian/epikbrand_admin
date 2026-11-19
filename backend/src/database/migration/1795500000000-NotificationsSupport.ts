import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NotificationsSupport1795500000000 implements MigrationInterface {
  name = 'NotificationsSupport1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Liste d'un utilisateur, du plus récent au plus ancien
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_user_created" ON "notifications" ("user_id", "created_at" DESC)`,
    );
    // Compteur de non-lues : appelé très souvent, l'index ne contient que les non-lues
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_user_unread" ON "notifications" ("user_id") WHERE "is_read" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_notifications_user_unread"`);
    await queryRunner.query(`DROP INDEX "public"."idx_notifications_user_created"`);
  }
}