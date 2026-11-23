import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Payroll1796100000000 implements MigrationInterface {
  name = 'Payroll1796100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "btree_gist"`);

    // ---------- Utilisateurs : rémunération (jamais exposée par les DTO existants) ----------
    await q.query(`ALTER TABLE "users"
      ADD COLUMN "base_salary" numeric(12,2),
      ADD COLUMN "dependents_count" integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "users"
      ADD CONSTRAINT "chk_user_base_salary" CHECK ("base_salary" IS NULL OR "base_salary" >= 0),
      ADD CONSTRAINT "chk_user_dependents" CHECK ("dependents_count" BETWEEN 0 AND 50)`);

    // ---------- Règles de paie ----------
    await q.query(`CREATE TABLE "payroll_rules" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "company_id" uuid NOT NULL,
      "code" character varying(50) NOT NULL,
      "label" character varying(255) NOT NULL,
      "item_type" "public"."salary_item_type" NOT NULL,
      "rule_type" character varying(15) NOT NULL,
      "base_kind" character varying(15),
      "rate" numeric(5,4),
      "fixed_amount" numeric(12,2),
      "base_cap" numeric(12,2),
      "rounding_step" numeric(12,2),
      "brackets" jsonb,
      "family_reduction" numeric(12,2) NOT NULL DEFAULT 0,
      "minimum_amount" numeric(12,2),
      "reduces_taxable_income" boolean NOT NULL DEFAULT false,
      "position" integer NOT NULL DEFAULT 0,
      "effective_from" date NOT NULL,
      "effective_to" date,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_payroll_rules" PRIMARY KEY ("id"),
      CONSTRAINT "FK_payroll_rules_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
      CONSTRAINT "chk_payroll_rule_values" CHECK (
        "rule_type" IN ('rate', 'fixed', 'progressive')
        AND ("base_kind" IS NULL OR "base_kind" IN ('base_salary', 'gross', 'taxable_income'))),
      CONSTRAINT "chk_payroll_rule_shape" CHECK (
        ("rule_type" = 'rate' AND "rate" IS NOT NULL AND "base_kind" IS NOT NULL)
        OR ("rule_type" = 'fixed' AND "fixed_amount" IS NOT NULL)
        OR ("rule_type" = 'progressive' AND "base_kind" IS NOT NULL AND jsonb_typeof("brackets") = 'array')),
      CONSTRAINT "chk_payroll_rule_dates" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
      CONSTRAINT "chk_payroll_rule_amounts" CHECK (
        ("rate" IS NULL OR ("rate" >= 0 AND "rate" <= 1))
        AND ("fixed_amount" IS NULL OR "fixed_amount" >= 0)
        AND ("base_cap" IS NULL OR "base_cap" > 0)
        AND ("rounding_step" IS NULL OR "rounding_step" > 0)
        AND "family_reduction" >= 0
        AND ("minimum_amount" IS NULL OR "minimum_amount" >= 0)))`);

    // Deux versions actives d'une même règle ne peuvent pas se chevaucher dans le temps
    await q.query(`ALTER TABLE "payroll_rules" ADD CONSTRAINT "excl_payroll_rule_period"
      EXCLUDE USING gist ("company_id" WITH =, "code" WITH =, daterange("effective_from", "effective_to", '[]') WITH &&)
      WHERE ("is_active")`);
    await q.query(`CREATE INDEX "idx_payroll_rules_company" ON "payroll_rules" ("company_id", "is_active", "effective_from")`);

    // ---------- Bulletins ----------
    await q.query(`ALTER TABLE "salaries" ALTER COLUMN "payment_method" DROP DEFAULT`);
    await q.query(`UPDATE "salaries" SET "payment_method" = NULL, "payment_date" = NULL WHERE "status" <> 'paid'`);
    await q.query(`ALTER TABLE "salaries" ADD COLUMN "dependents_count" integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "salaries"
      ADD CONSTRAINT "chk_salary_amounts" CHECK (
        "base_salary" >= 0 AND "gross_salary" >= 0 AND "total_deductions" >= 0 AND "net_salary" >= 0
        AND "dependents_count" BETWEEN 0 AND 50),
      ADD CONSTRAINT "chk_salary_payment" CHECK (
        ("status" = 'paid' AND "payment_date" IS NOT NULL AND "payment_method" IS NOT NULL)
        OR ("status" <> 'paid' AND "payment_date" IS NULL AND "payment_method" IS NULL))`);
    await q.query(`CREATE INDEX "idx_salaries_company_month" ON "salaries" ("company_id", "month")`);

    // ---------- Lignes de bulletin ----------
    await q.query(`ALTER TABLE "salary_items"
      ADD COLUMN "position" integer NOT NULL DEFAULT 0,
      ADD COLUMN "rule_id" uuid,
      ADD COLUMN "is_manual" boolean NOT NULL DEFAULT true`);
    await q.query(`WITH ranked AS (
         SELECT "id", ROW_NUMBER() OVER (PARTITION BY "salary_id" ORDER BY "type" DESC, "id") - 1 AS pos
           FROM "salary_items")
       UPDATE "salary_items" si SET "position" = r.pos FROM ranked r WHERE si."id" = r."id"`);
    await q.query(`ALTER TABLE "salary_items"
      ADD CONSTRAINT "chk_salary_item_amounts" CHECK (
        "amount" >= 0 AND ("base_amount" IS NULL OR "base_amount" >= 0)
        AND ("rate" IS NULL OR ("rate" >= 0 AND "rate" <= 1))),
      ADD CONSTRAINT "chk_salary_item_position" CHECK ("position" >= 0),
      ADD CONSTRAINT "uq_salary_item_position" UNIQUE ("salary_id", "position"),
      ADD CONSTRAINT "FK_salary_items_rule" FOREIGN KEY ("rule_id") REFERENCES "payroll_rules"("id") ON DELETE SET NULL`);
    await q.query(`CREATE INDEX "idx_salary_items_rule" ON "salary_items" ("rule_id") WHERE "rule_id" IS NOT NULL`);

    // ---------- Cohérence brut / retenues, vérifiée à la validation de la transaction ----------
    await q.query(`CREATE FUNCTION check_salary_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        sid uuid;
        s RECORD;
        earnings numeric;
        deductions numeric;
      BEGIN
        IF TG_TABLE_NAME = 'salaries' THEN
          sid := NEW.id;
        ELSIF TG_OP = 'DELETE' THEN
          sid := OLD.salary_id;
        ELSE
          sid := NEW.salary_id;
        END IF;

        SELECT base_salary, gross_salary, total_deductions INTO s FROM salaries WHERE id = sid;
        IF NOT FOUND THEN RETURN NULL; END IF; -- bulletin supprimé : ses lignes partent avec lui

        SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'earning'), 0),
               COALESCE(SUM(amount) FILTER (WHERE type = 'deduction'), 0)
          INTO earnings, deductions
          FROM salary_items WHERE salary_id = sid;

        IF s.gross_salary <> s.base_salary + earnings THEN
          RAISE EXCEPTION 'Salaire brut incohérent avec le salaire de base et les gains'
            USING ERRCODE = '23514', CONSTRAINT = 'chk_salary_gross_consistency';
        END IF;
        IF s.total_deductions <> deductions THEN
          RAISE EXCEPTION 'Total des retenues incohérent avec les lignes de retenue'
            USING ERRCODE = '23514', CONSTRAINT = 'chk_salary_deductions_consistency';
        END IF;
        RETURN NULL;
      END
      $$`);
    await q.query(`CREATE CONSTRAINT TRIGGER trg_salary_consistency
      AFTER INSERT OR UPDATE ON "salaries"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_salary_consistency()`);
    await q.query(`CREATE CONSTRAINT TRIGGER trg_salary_items_consistency
      AFTER INSERT OR UPDATE OR DELETE ON "salary_items"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_salary_consistency()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER "trg_salary_items_consistency" ON "salary_items"`);
    await q.query(`DROP TRIGGER "trg_salary_consistency" ON "salaries"`);
    await q.query(`DROP FUNCTION "check_salary_consistency"()`);

    await q.query(`DROP INDEX "public"."idx_salary_items_rule"`);
    await q.query(`ALTER TABLE "salary_items"
      DROP CONSTRAINT "FK_salary_items_rule",
      DROP CONSTRAINT "uq_salary_item_position",
      DROP CONSTRAINT "chk_salary_item_position",
      DROP CONSTRAINT "chk_salary_item_amounts"`);
    await q.query(`ALTER TABLE "salary_items" DROP COLUMN "is_manual", DROP COLUMN "rule_id", DROP COLUMN "position"`);

    await q.query(`DROP INDEX "public"."idx_salaries_company_month"`);
    await q.query(`ALTER TABLE "salaries" DROP CONSTRAINT "chk_salary_payment", DROP CONSTRAINT "chk_salary_amounts"`);
    await q.query(`ALTER TABLE "salaries" DROP COLUMN "dependents_count"`);
    await q.query(`ALTER TABLE "salaries" ALTER COLUMN "payment_method" SET DEFAULT 'virement'`);

    await q.query(`DROP TABLE "payroll_rules"`);
    await q.query(`ALTER TABLE "users" DROP CONSTRAINT "chk_user_dependents", DROP CONSTRAINT "chk_user_base_salary"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "dependents_count", DROP COLUMN "base_salary"`);
  }
}