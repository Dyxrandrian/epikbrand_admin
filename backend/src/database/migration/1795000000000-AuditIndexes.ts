import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditIndexes1795000000000 implements MigrationInterface {
  name = 'AuditIndexes1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_audit_company_created" ON "audit_logs" ("company_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_entity" ON "audit_logs" ("company_id", "entity_type", "entity_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_audit_entity"`);
    await queryRunner.query(`DROP INDEX "public"."idx_audit_company_created"`);
  }
}