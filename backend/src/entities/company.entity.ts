import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import type { User } from './user.entity.js';
import { bigintTransformer, numericTransformer } from '../transformers/numeric.transformer.js';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'logo_url', type: 'varchar', length: 255, nullable: true })
  logoUrl: string | null;

  @Column({ name: 'cover_url', type: 'varchar', length: 255, nullable: true })
  coverUrl: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'website_url', type: 'varchar', length: 255, nullable: true })
  websiteUrl: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ name: 'tax_info', type: 'varchar', length: 100, nullable: true })
  taxInfo: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  nif: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  stat: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  rcs: string | null;

  @Column({ name: 'default_currency', type: 'char', length: 3, default: 'MGA' })
  defaultCurrency: string;

  @Column({ name: 'default_vat_rate', type: 'numeric', precision: 5, scale: 4, default: 0.2, transformer: numericTransformer })
  defaultVatRate: number;

  @Column({ type: 'varchar', length: 50, default: 'Indian/Antananarivo' })
  timezone: string;

  @Column({ name: 'storage_quota_bytes', type: 'bigint', default: '5368709120', transformer: bigintTransformer })
  storageQuotaBytes: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'bank_name', type: 'varchar', length: 100, nullable: true })
  bankName: string | null;

  @Column({ name: 'bank_account_holder', type: 'varchar', length: 100, nullable: true })
  bankAccountHolder: string | null;

  /** RIB ou IBAN */
  @Column({ name: 'bank_account_number', type: 'varchar', length: 50, nullable: true })
  bankAccountNumber: string | null;

  @Column({ name: 'bank_swift', type: 'varchar', length: 11, nullable: true })
  bankSwift: string | null;

  /** MVola, Orange Money, Airtel Money… (texte libre, imprimé sur les documents) */
  @Column({ name: 'mobile_money_details', type: 'text', nullable: true })
  mobileMoneyDetails: string | null;

  @Column({ name: 'invoice_footer', type: 'text', nullable: true })
  invoiceFooter: string | null;

  @OneToMany('User', (user: any) => user.company)
  users: User[];
}