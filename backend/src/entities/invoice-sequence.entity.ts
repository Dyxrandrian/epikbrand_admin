import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { Company } from './company.entity.js';
import { InvoiceDocumentType } from '../enums/app.enums.js';

@Entity('invoice_sequences')
export class InvoiceSequence {
  @PrimaryColumn({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @PrimaryColumn({ type: 'enum', enum: InvoiceDocumentType })
  type: InvoiceDocumentType;

  @PrimaryColumn({ type: 'smallint' })
  year: number;

  /** ex. FAC, DEV, AVO */
  @Column({ type: 'varchar', length: 10 })
  prefix: string;

  @Column({ name: 'last_number', type: 'int', default: 0 })
  lastNumber: number;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}