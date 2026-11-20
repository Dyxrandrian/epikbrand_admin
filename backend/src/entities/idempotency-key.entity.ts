import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Check, Index, Unique } from 'typeorm';
import type { Company } from './company.entity.js';
import type { User } from './user.entity.js';

@Check('chk_idempotency_status', `"status" IN ('in_progress', 'completed')`)
@Index('idx_idempotency_expires', { synchronize: false })
@Unique('uq_idempotency_scope', ['companyId', 'userId', 'key'])
@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  key: string;

  /** Empreinte (SHA-256) de la requête : une clé ne vaut que pour une requête */
  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash: string;

  @Column({ type: 'varchar', length: 15, default: 'in_progress' })
  status: 'in_progress' | 'completed';

  /** Réponse à rejouer (NULL tant que la requête est en cours) */
  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}