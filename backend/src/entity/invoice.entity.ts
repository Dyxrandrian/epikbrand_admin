import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn, Unique } from 'typeorm';
import { Company } from './company.entity.js';
import { Client } from './client.entity.js';
import { InvoiceItem } from './invoice-item.entity.js';
import { InvoiceDocumentType, InvoicePaymentStatus } from '../enums/app.enums.js';

@Entity('invoices')
@Unique(['companyId', 'invoiceNumber'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ name: 'invoice_number', length: 50 })
  invoiceNumber: string;

  @Column({ type: 'enum', enum: InvoiceDocumentType, enumName: 'invoice_document_type', default: InvoiceDocumentType.INVOICE })
  type: InvoiceDocumentType;

  @Column({ type: 'enum', enum: InvoicePaymentStatus, enumName: 'invoice_payment_status', default: InvoicePaymentStatus.DRAFT })
  status: InvoicePaymentStatus;

  @Column({ name: 'issue_date', type: 'date', default: () => 'CURRENT_DATE' })
  issueDate: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Client, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @OneToMany(() => InvoiceItem, (item) => item.invoice, { cascade: true })
  items: InvoiceItem[];
}