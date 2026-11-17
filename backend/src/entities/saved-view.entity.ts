import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import type { Company } from './company.entity.js';
import type { User } from './user.entity.js';

@Entity('saved_views')
export class SavedView {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  /** tasks, invoices, expenses, ... */
  @Column({ type: 'varchar', length: 30 })
  resource: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Filtres, tri et colonnes sauvegardés */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;

  @Column({ name: 'is_shared', type: 'boolean', default: false })
  isShared: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;
}