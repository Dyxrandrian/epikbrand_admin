import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Invoice } from './invoice.entity.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Entity('invoice_items')
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1, transformer: numericTransformer })
  quantity: number;

  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  unitPrice: number;

  @ManyToOne(() => Invoice, (invoice) => invoice.items, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}
