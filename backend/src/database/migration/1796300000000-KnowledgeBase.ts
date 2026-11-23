import type { MigrationInterface, QueryRunner } from 'typeorm';

export class KnowledgeBase1796300000000 implements MigrationInterface {
  name = 'KnowledgeBase1796300000000';

  public async up(q: QueryRunner): Promise<void> {
    // ---------- Articles : texte brut pour la recherche dans les contenus ----------
    await q.query(`ALTER TABLE "agency_articles" ADD COLUMN "search_text" text NOT NULL DEFAULT ''`);
    // Lignes éventuellement créées avant ce module : approximation, remplacée au prochain enregistrement
    await q.query(`UPDATE "agency_articles" SET "search_text" = left("content", 100000) WHERE "search_text" = ''`);

    await q.query(`ALTER TABLE "agency_articles"
      ADD CONSTRAINT "chk_article_title" CHECK (length(btrim("title")) > 0),
      ADD CONSTRAINT "chk_article_version" CHECK ("version" >= 1)`);
    await q.query(`ALTER TABLE "agency_article_versions" ADD CONSTRAINT "chk_article_version_number" CHECK ("version" >= 1)`);

    await q.query(`CREATE INDEX "idx_articles_search_text" ON "agency_articles" USING gin (f_unaccent("search_text") gin_trgm_ops)`);
    await q.query(`CREATE INDEX "idx_articles_company_updated" ON "agency_articles" ("company_id", "updated_at" DESC) WHERE "archived_at" IS NULL`);
    await q.query(`CREATE INDEX "idx_articles_section" ON "agency_articles" ("section_id")`);
    await q.query(`CREATE INDEX "idx_articles_category" ON "agency_articles" ("category_id") WHERE "category_id" IS NOT NULL`);

    // ---------- Structure de l'agence ----------
    await q.query(`CREATE INDEX "idx_agency_structure_type" ON "agency_structure" ("company_id", "type_id", "created_at")`);
    await q.query(`CREATE UNIQUE INDEX "uq_agency_structure_value" ON "agency_structure" ("company_id", "type_id", lower("value"))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."uq_agency_structure_value"`);
    await q.query(`DROP INDEX "public"."idx_agency_structure_type"`);
    await q.query(`DROP INDEX "public"."idx_articles_category"`);
    await q.query(`DROP INDEX "public"."idx_articles_section"`);
    await q.query(`DROP INDEX "public"."idx_articles_company_updated"`);
    await q.query(`DROP INDEX "public"."idx_articles_search_text"`);
    await q.query(`ALTER TABLE "agency_article_versions" DROP CONSTRAINT "chk_article_version_number"`);
    await q.query(`ALTER TABLE "agency_articles" DROP CONSTRAINT "chk_article_version", DROP CONSTRAINT "chk_article_title"`);
    await q.query(`ALTER TABLE "agency_articles" DROP COLUMN "search_text"`);
  }
}