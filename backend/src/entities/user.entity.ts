import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Index, Check } from 'typeorm';
import type { Company } from './company.entity.js';
import type { UserToken } from './user-token.entity.js';
import type { RefreshToken } from './refresh-token.entity.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

import { UserRole } from '../enums/app.enums.js';
@Check('chk_user_base_salary', '"base_salary" IS NULL OR "base_salary" >= 0')
@Check('chk_user_dependents', '"dependents_count" BETWEEN 0 AND 50')
@Index('idx_search_users_full', { synchronize: false })
@Index('idx_search_users', { synchronize: false })
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'citext', unique: true })
  email: string;

  /** NULL tant que l'invitation n'est pas acceptée */
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role', default: UserRole.COLLABORATOR })
  role: UserRole;

  @Column({ name: 'avatar_url', type: 'varchar', length: 255, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified: boolean;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  matricule: string | null;

  @Column({ name: 'job_title', type: 'varchar', length: 100, nullable: true })
  jobTitle: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Salaire de base mensuel : jamais chargé avec l'utilisateur, lu uniquement par le module Paie */
  @Column({ name: 'base_salary', type: 'numeric', precision: 12, scale: 2, nullable: true, select: false, transformer: numericTransformer })
  baseSalary?: number | null;

  /** Personnes à charge (réduction IRSA) : même précaution */
  @Column({ name: 'dependents_count', type: 'int', default: 0, select: false })
  dependentsCount?: number;

  // Use string 'Company' and type-only callback parameters
  @ManyToOne('Company', (company: any) => company.users, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  // Use string 'UserToken'
  @OneToMany('UserToken', (token: any) => token.user)
  tokens: UserToken[];

  // Use string 'RefreshToken'
  @OneToMany('RefreshToken', (token: any) => token.user)
  refreshTokens: RefreshToken[];
}