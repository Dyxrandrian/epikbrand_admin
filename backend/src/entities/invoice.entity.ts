import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Unique, VersionColumn, Check, Index } from 'typeorm';
import type { Company } from './company.entity.js';
import type { Client } from './client.entity.js';
import type { Project } from './project.entity.js';
import type { InvoiceItem } from './invoice-item.entity.js';
import { InvoiceDocumentType, InvoicePaymentStatus, PaymentMethod } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Check('chk_invoice_dates', '"due_date" IS NULL OR "due_date" >= "issue_date"')
@Index('idx_invoices_client', { synchronize: false })
@Index('idx_search_invoice_number', { synchronize: false })
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

  /** Devis d'origine, ou facture corrigée par un avoir */
  @Column({ name: 'source_document_id', type: 'uuid', nullable: true })
  sourceDocumentId: string | null;

  @Column({ name: 'invoice_number', type: 'varchar', length: 50 })
  invoiceNumber: string;

  @Column({ type: 'enum', enum: InvoiceDocumentType, default: InvoiceDocumentType.INVOICE })
  type: InvoiceDocumentType;

  @Column({ type: 'enum', enum: InvoicePaymentStatus, enumName: 'invoice_payment_status', default: InvoicePaymentStatus.DRAFT })
  status: InvoicePaymentStatus;

  /** Format YYYY-MM-DD */
  @Column({ name: 'issue_date', type: 'date', default: () => 'CURRENT_DATE' })
  issueDate: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'char', length: 3, default: 'MGA' })
  currency: string;

  @Column({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 4, default: 0.2, transformer: numericTransformer })
  vatRate: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'payment_terms', type: 'text', nullable: true })
  paymentTerms: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  /** Format YYYY-MM-DD */
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

  @ManyToOne('Invoice', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_document_id' })
  sourceDocument: Invoice | null;

  @OneToMany('InvoiceItem', (item: any) => item.invoice)
  items: InvoiceItem[];
}