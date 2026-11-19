import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { Company } from './company.entity.js';
import type { Client } from './client.entity.js';
import type { User } from './user.entity.js';
import { Index } from 'typeorm';

@Index('idx_interactions_client_date', { synchronize: false })
@Index('idx_interactions_company_date', { synchronize: false })
@Entity('interactions')
export class Interaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'text' })
  summary: string;

  @Column({ name: 'interaction_date', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  interactionDate: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('Client', (client: any) => client.interactions, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;
}