import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Unique, VersionColumn, Check, Index } from 'typeorm';
import type { Company } from './company.entity.js';
import type { Client } from './client.entity.js';
import type { Project } from './project.entity.js';
import type { InvoiceItem } from './invoice-item.entity.js';
import { DiscountType, InvoiceDocumentType, InvoicePaymentStatus, PaymentMethod } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

/** Client tel qu'il figure sur le document au moment de l'émission. */
export interface ClientSnapshot {
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  nif: string | null;
  stat: string | null;
}

/** Entreprise telle qu'elle figure sur le document au moment de l'émission. */
export interface SellerSnapshot {
  name: string;
  address: string | null;
  phone: string | null;
  website_url: string | null;
  tax_info: string | null;
  nif: string | null;
  stat: string | null;
  rcs: string | null;
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number: string | null;
  bank_swift: string | null;
  mobile_money_details: string | null;
  invoice_footer: string | null;
}


@Check('chk_invoice_dates', '"due_date" IS NULL OR "due_date" >= "issue_date"')
@Check('chk_invoice_number_when_issued', `"status" = 'draft' OR "invoice_number" IS NOT NULL`)
@Check('chk_invoice_discount', `("discount_type" IS NULL AND "discount_value" = 0 AND "discount_amount" = 0) OR ("discount_type" = 'percent' AND "discount_value" > 0 AND "discount_value" <= 100) OR ("discount_type" = 'amount' AND "discount_value" > 0)`)
@Check('chk_invoice_totals', '"subtotal_ht" >= 0 AND "discount_amount" >= 0 AND "discount_amount" <= "subtotal_ht" AND "total_ht" = "subtotal_ht" - "discount_amount" AND "total_vat" >= 0 AND "total_ttc" = "total_ht" + "total_vat"')
@Check('chk_invoice_vat_rate', '"vat_rate" >= 0 AND "vat_rate" <= 1')
@Check('chk_invoice_payments', '"amount_paid" >= 0 AND "credited_total" >= 0 AND "amount_paid" <= "total_ttc" AND "credited_total" <= "total_ttc"')
@Check('chk_invoice_only_invoice_is_paid', `"type" = 'invoice' OR ("amount_paid" = 0 AND "credited_total" = 0)`)
@Check('chk_invoice_quote_fields', `"type" = 'quote' OR ("valid_until" IS NULL AND "accepted_at" IS NULL AND "rejected_at" IS NULL)`)
@Check('chk_invoice_quote_decision', '"accepted_at" IS NULL OR "rejected_at" IS NULL')
@Check('chk_invoice_valid_until', '"valid_until" IS NULL OR "valid_until" >= "issue_date"')
@Check('chk_invoice_credit_source', `"type" <> 'credit_note' OR "source_document_id" IS NOT NULL`)
@Index('idx_invoices_client', { synchronize: false })
@Index('idx_invoices_company_due', { synchronize: false })
@Index('idx_invoices_quote_accepted', { synchronize: false })
@Index('idx_search_invoice_number', { synchronize: false })
@Index('idx_invoices_company_issue', { synchronize: false })
@Index('idx_invoices_company_status', { synchronize: false })
@Index('idx_invoices_due_open', { synchronize: false })
@Index('idx_invoices_source', { synchronize: false })
@Index('idx_invoices_project', { synchronize: false })
@Index('uq_invoices_one_invoice_per_quote', { synchronize: false })
@Entity('invoices')
@Unique(['companyId', 'invoiceNumber'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  /** Devis d'origine (facture), ou facture corrigée (avoir) */
  @Column({ name: 'source_document_id', type: 'uuid', nullable: true })
  sourceDocumentId: string | null;

  /** NULL tant que le document est un brouillon : le numéro est attribué à l'émission */
  @Column({ name: 'invoice_number', type: 'varchar', length: 50, nullable: true })
  invoiceNumber: string | null;

  @Column({ type: 'enum', enum: InvoiceDocumentType, default: InvoiceDocumentType.INVOICE })
  type: InvoiceDocumentType;

  @Column({ type: 'enum', enum: InvoicePaymentStatus, enumName: 'invoice_payment_status', default: InvoicePaymentStatus.DRAFT })
  status: InvoicePaymentStatus;

  /** Format YYYY-MM-DD */
  @Column({ name: 'issue_date', type: 'date', default: () => 'CURRENT_DATE' })
  issueDate: string;

  /** Échéance de paiement (factures). Format YYYY-MM-DD */
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  /** Fin de validité (devis seulement). Format YYYY-MM-DD */
  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil: string | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @Column({ type: 'char', length: 3, default: 'MGA' })
  currency: string;

  /** Taux par défaut des nouvelles lignes ; chaque ligne porte son propre taux */
  @Column({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 4, default: 0.2, transformer: numericTransformer })
  vatRate: number;

  @Column({ name: 'discount_type', type: 'varchar', length: 10, nullable: true })
  discountType: DiscountType | null;

  @Column({ name: 'discount_value', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  discountValue: number;

  /** Somme des lignes (après remises de ligne), avant remise globale */
  @Column({ name: 'subtotal_ht', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  subtotalHt: number;

  /** Montant de la remise globale */
  @Column({ name: 'discount_amount', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  discountAmount: number;

  @Column({ name: 'total_ht', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  totalHt: number;

  @Column({ name: 'total_vat', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  totalVat: number;

  @Column({ name: 'total_ttc', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  totalTtc: number;

  @Column({ name: 'amount_paid', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  amountPaid: number;

  /** Total des avoirs émis sur cette facture */
  @Column({ name: 'credited_total', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  creditedTotal: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'payment_terms', type: 'text', nullable: true })
  paymentTerms: string | null;

  /** Pied de page propre au document ; sinon celui de l'entreprise */
  @Column({ type: 'text', nullable: true })
  footer: string | null;

  @Column({ name: 'client_snapshot', type: 'jsonb', nullable: true })
  clientSnapshot: ClientSnapshot | null;

  @Column({ name: 'seller_snapshot', type: 'jsonb', nullable: true })
  sellerSnapshot: SellerSnapshot | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  /** Date du règlement qui solde la facture. Format YYYY-MM-DD */
  @Column({ name: 'paid_at', type: 'date', nullable: true })
  paidAt: string | null;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod, nullable: true })
  paymentMethod: PaymentMethod | null;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('Client', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @ManyToOne('Project', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  @ManyToOne('Invoice', { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'source_document_id' })
  sourceDocument: Invoice | null;

  @OneToMany('InvoiceItem', (item: any) => item.invoice)
  items: InvoiceItem[];
}