import type { MigrationInterface, QueryRunner } from 'typeorm';

const DISCOUNT_RULE = `("discount_type" IS NULL AND "discount_value" = 0 AND "discount_amount" = 0)
  OR ("discount_type" = 'percent' AND "discount_value" > 0 AND "discount_value" <= 100)
  OR ("discount_type" = 'amount' AND "discount_value" > 0)`;

export class InvoicesOverhaul1795700000000 implements MigrationInterface {
  name = 'InvoicesOverhaul1795700000000';

  public async up(q: QueryRunner): Promise<void> {
    // ---------- Entreprise : coordonnées de paiement et pied de page ----------
    await q.query(`ALTER TABLE "companies"
      ADD COLUMN "bank_name" character varying(100),
      ADD COLUMN "bank_account_holder" character varying(100),
      ADD COLUMN "bank_account_number" character varying(50),
      ADD COLUMN "bank_swift" character varying(11),
      ADD COLUMN "mobile_money_details" text,
      ADD COLUMN "invoice_footer" text`);

    // ---------- Client professionnel ----------
    await q.query(`ALTER TABLE "clients"
      ADD COLUMN "nif" character varying(50),
      ADD COLUMN "stat" character varying(50)`);

    // ---------- Lignes ----------
    await q.query(`ALTER TABLE "invoice_items"
      ADD COLUMN "unit" character varying(20),
      ADD COLUMN "vat_rate" numeric(5,4),
      ADD COLUMN "discount_type" character varying(10),
      ADD COLUMN "discount_value" numeric(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN "discount_amount" numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN "total_ht" numeric(14,2) NOT NULL DEFAULT 0`);

    // ---------- Documents ----------
    await q.query(`ALTER TABLE "invoices" ALTER COLUMN "invoice_number" DROP NOT NULL`);
    await q.query(`ALTER TABLE "invoices"
      ADD COLUMN "valid_until" date,
      ADD COLUMN "accepted_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "rejected_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "footer" text,
      ADD COLUMN "discount_type" character varying(10),
      ADD COLUMN "discount_value" numeric(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN "subtotal_ht" numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN "discount_amount" numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN "total_ht" numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN "total_vat" numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN "total_ttc" numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN "amount_paid" numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN "credited_total" numeric(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN "client_snapshot" jsonb,
      ADD COLUMN "seller_snapshot" jsonb`);

    // ---------- Reprise des données existantes ----------
    await q.query(`UPDATE "invoice_items" it
         SET "vat_rate" = i."vat_rate",
             "total_ht" = ROUND(it."quantity" * it."unit_price", 2)
        FROM "invoices" i
       WHERE i."id" = it."invoice_id"`);
    await q.query(`ALTER TABLE "invoice_items" ALTER COLUMN "vat_rate" SET NOT NULL`);
    await q.query(`UPDATE "invoices" i
         SET "subtotal_ht" = s.total,
             "total_ht" = s.total,
             "total_vat" = ROUND(s.total * i."vat_rate", 2),
             "total_ttc" = s.total + ROUND(s.total * i."vat_rate", 2)
        FROM (SELECT "invoice_id", SUM("total_ht") AS total FROM "invoice_items" GROUP BY "invoice_id") s
       WHERE s."invoice_id" = i."id"`);
    await q.query(`UPDATE "invoices" SET "amount_paid" = "total_ttc" WHERE "status" = 'paid'`);
    await q.query(`WITH ranked AS (
         SELECT "id", ROW_NUMBER() OVER (PARTITION BY "invoice_id" ORDER BY "position", "id") - 1 AS pos
           FROM "invoice_items")
       UPDATE "invoice_items" it SET "position" = r.pos FROM ranked r WHERE it."id" = r."id"`);

    // ---------- Contraintes : lignes ----------
    await q.query(`ALTER TABLE "invoice_items"
      ADD CONSTRAINT "chk_invoice_item_quantity" CHECK ("quantity" > 0),
      ADD CONSTRAINT "chk_invoice_item_price" CHECK ("unit_price" >= 0),
      ADD CONSTRAINT "chk_invoice_item_position" CHECK ("position" >= 0),
      ADD CONSTRAINT "chk_invoice_item_vat" CHECK ("vat_rate" >= 0 AND "vat_rate" <= 1),
      ADD CONSTRAINT "chk_invoice_item_discount" CHECK (${DISCOUNT_RULE}),
      ADD CONSTRAINT "chk_invoice_item_totals" CHECK ("total_ht" >= 0 AND "discount_amount" >= 0),
      ADD CONSTRAINT "uq_invoice_item_position" UNIQUE ("invoice_id", "position")`);

    // ---------- Contraintes : documents ----------
    await q.query(`ALTER TABLE "invoices"
      ADD CONSTRAINT "chk_invoice_number_when_issued" CHECK ("status" = 'draft' OR "invoice_number" IS NOT NULL),
      ADD CONSTRAINT "chk_invoice_discount" CHECK (${DISCOUNT_RULE}),
      ADD CONSTRAINT "chk_invoice_totals" CHECK (
        "subtotal_ht" >= 0 AND "discount_amount" >= 0 AND "discount_amount" <= "subtotal_ht"
        AND "total_ht" = "subtotal_ht" - "discount_amount"
        AND "total_vat" >= 0
        AND "total_ttc" = "total_ht" + "total_vat"),
      ADD CONSTRAINT "chk_invoice_vat_rate" CHECK ("vat_rate" >= 0 AND "vat_rate" <= 1),
      ADD CONSTRAINT "chk_invoice_payments" CHECK (
        "amount_paid" >= 0 AND "credited_total" >= 0
        AND "amount_paid" <= "total_ttc" AND "credited_total" <= "total_ttc"),
      ADD CONSTRAINT "chk_invoice_only_invoice_is_paid" CHECK (
        "type" = 'invoice' OR ("amount_paid" = 0 AND "credited_total" = 0)),
      ADD CONSTRAINT "chk_invoice_quote_fields" CHECK (
        "type" = 'quote' OR ("valid_until" IS NULL AND "accepted_at" IS NULL AND "rejected_at" IS NULL)),
      ADD CONSTRAINT "chk_invoice_quote_decision" CHECK ("accepted_at" IS NULL OR "rejected_at" IS NULL),
      ADD CONSTRAINT "chk_invoice_valid_until" CHECK ("valid_until" IS NULL OR "valid_until" >= "issue_date"),
      ADD CONSTRAINT "chk_invoice_credit_source" CHECK ("type" <> 'credit_note' OR "source_document_id" IS NOT NULL)`);

    // ---------- Lien vers le document d'origine : SET NULL devient NO ACTION ----------
    await q.query(`ALTER TABLE "invoices" DROP CONSTRAINT "FK_2c8257613406df2ad6f60fdbc7d"`);
    await q.query(`ALTER TABLE "invoices" ADD CONSTRAINT "FK_2c8257613406df2ad6f60fdbc7d"
      FOREIGN KEY ("source_document_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

    // ---------- Paiements ----------
    await q.query(`CREATE TABLE "invoice_payments" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "company_id" uuid NOT NULL,
      "invoice_id" uuid NOT NULL,
      "amount" numeric(14,2) NOT NULL,
      "paid_at" date NOT NULL,
      "method" "public"."invoices_payment_method_enum" NOT NULL,
      "reference" character varying(100),
      "notes" text,
      "created_by" uuid,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_invoice_payments" PRIMARY KEY ("id"),
      CONSTRAINT "chk_invoice_payment_amount" CHECK ("amount" > 0),
      CONSTRAINT "FK_invoice_payments_company" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_invoice_payments_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_invoice_payments_user" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL)`);

    // ---------- Index ----------
    await q.query(`CREATE INDEX "idx_invoices_company_issue" ON "invoices" ("company_id", "issue_date" DESC)`);
    await q.query(`CREATE INDEX "idx_invoices_company_status" ON "invoices" ("company_id", "status")`);
    await q.query(`CREATE INDEX "idx_invoices_due_open" ON "invoices" ("company_id", "due_date") WHERE "status" IN ('sent', 'overdue')`);
    await q.query(`CREATE INDEX "idx_invoices_source" ON "invoices" ("source_document_id") WHERE "source_document_id" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_invoices_project" ON "invoices" ("project_id") WHERE "project_id" IS NOT NULL`);
    // Un devis ne donne qu'une facture active : la conversion est idempotente jusque dans la base
    await q.query(`CREATE UNIQUE INDEX "uq_invoices_one_invoice_per_quote" ON "invoices" ("source_document_id")
      WHERE "type" = 'invoice' AND "status" <> 'cancelled' AND "source_document_id" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_invoice_payments_invoice" ON "invoice_payments" ("invoice_id", "paid_at")`);
    await q.query(`CREATE INDEX "idx_invoice_payments_company_date" ON "invoice_payments" ("company_id", "paid_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."idx_invoice_payments_company_date"`);
    await q.query(`DROP INDEX "public"."idx_invoice_payments_invoice"`);
    await q.query(`DROP INDEX "public"."uq_invoices_one_invoice_per_quote"`);
    await q.query(`DROP INDEX "public"."idx_invoices_project"`);
    await q.query(`DROP INDEX "public"."idx_invoices_source"`);
    await q.query(`DROP INDEX "public"."idx_invoices_due_open"`);
    await q.query(`DROP INDEX "public"."idx_invoices_company_status"`);
    await q.query(`DROP INDEX "public"."idx_invoices_company_issue"`);
    await q.query(`DROP TABLE "invoice_payments"`);

    await q.query(`ALTER TABLE "invoices" DROP CONSTRAINT "FK_2c8257613406df2ad6f60fdbc7d"`);
    await q.query(`ALTER TABLE "invoices" ADD CONSTRAINT "FK_2c8257613406df2ad6f60fdbc7d"
      FOREIGN KEY ("source_document_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

    await q.query(`ALTER TABLE "invoices"
      DROP CONSTRAINT "chk_invoice_credit_source",
      DROP CONSTRAINT "chk_invoice_valid_until",
      DROP CONSTRAINT "chk_invoice_quote_decision",
      DROP CONSTRAINT "chk_invoice_quote_fields",
      DROP CONSTRAINT "chk_invoice_only_invoice_is_paid",
      DROP CONSTRAINT "chk_invoice_payments",
      DROP CONSTRAINT "chk_invoice_vat_rate",
      DROP CONSTRAINT "chk_invoice_totals",
      DROP CONSTRAINT "chk_invoice_discount",
      DROP CONSTRAINT "chk_invoice_number_when_issued"`);
    await q.query(`ALTER TABLE "invoice_items"
      DROP CONSTRAINT "uq_invoice_item_position",
      DROP CONSTRAINT "chk_invoice_item_totals",
      DROP CONSTRAINT "chk_invoice_item_discount",
      DROP CONSTRAINT "chk_invoice_item_vat",
      DROP CONSTRAINT "chk_invoice_item_position",
      DROP CONSTRAINT "chk_invoice_item_price",
      DROP CONSTRAINT "chk_invoice_item_quantity"`);

    await q.query(`UPDATE "invoices" SET "invoice_number" = 'BROUILLON-' || "id" WHERE "invoice_number" IS NULL`);
    await q.query(`ALTER TABLE "invoices" ALTER COLUMN "invoice_number" SET NOT NULL`);
    await q.query(`ALTER TABLE "invoices"
      DROP COLUMN "seller_snapshot", DROP COLUMN "client_snapshot", DROP COLUMN "credited_total",
      DROP COLUMN "amount_paid", DROP COLUMN "total_ttc", DROP COLUMN "total_vat",
      DROP COLUMN "total_ht", DROP COLUMN "discount_amount", DROP COLUMN "subtotal_ht",
      DROP COLUMN "discount_value", DROP COLUMN "discount_type", DROP COLUMN "footer",
      DROP COLUMN "rejected_at", DROP COLUMN "accepted_at", DROP COLUMN "valid_until"`);
    await q.query(`ALTER TABLE "invoice_items"
      DROP COLUMN "total_ht", DROP COLUMN "discount_amount", DROP COLUMN "discount_value",
      DROP COLUMN "discount_type", DROP COLUMN "vat_rate", DROP COLUMN "unit"`);
    await q.query(`ALTER TABLE "clients" DROP COLUMN "stat", DROP COLUMN "nif"`);
    await q.query(`ALTER TABLE "companies"
      DROP COLUMN "invoice_footer", DROP COLUMN "mobile_money_details", DROP COLUMN "bank_swift",
      DROP COLUMN "bank_account_number", DROP COLUMN "bank_account_holder", DROP COLUMN "bank_name"`);
  }
}