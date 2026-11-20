import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Check, Unique } from 'typeorm';
import type { Invoice } from './invoice.entity.js';
import { DiscountType } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Check('chk_invoice_item_quantity', '"quantity" > 0')
@Check('chk_invoice_item_price', '"unit_price" >= 0')
@Check('chk_invoice_item_position', '"position" >= 0')
@Check('chk_invoice_item_vat', '"vat_rate" >= 0 AND "vat_rate" <= 1')
@Check('chk_invoice_item_discount', `("discount_type" IS NULL AND "discount_value" = 0 AND "discount_amount" = 0) OR ("discount_type" = 'percent' AND "discount_value" > 0 AND "discount_value" <= 100) OR ("discount_type" = 'amount' AND "discount_value" > 0)`)
@Check('chk_invoice_item_totals', '"total_ht" >= 0 AND "discount_amount" >= 0')
@Unique('uq_invoice_item_position', ['invoiceId', 'position'])
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

  /** Unité libre : h, jour, pièce… */
  @Column({ type: 'varchar', length: 20, nullable: true })
  unit: string | null;

  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  unitPrice: number;

  @Column({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 4, transformer: numericTransformer })
  vatRate: number;

  @Column({ name: 'discount_type', type: 'varchar', length: 10, nullable: true })
  discountType: DiscountType | null;

  @Column({ name: 'discount_value', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  discountValue: number;

  /** Montant de la remise de la ligne */
  @Column({ name: 'discount_amount', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  discountAmount: number;

  /** Total HT de la ligne, après remise */
  @Column({ name: 'total_ht', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: numericTransformer })
  totalHt: number;

  @ManyToOne('Invoice', (invoice: any) => invoice.items, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}