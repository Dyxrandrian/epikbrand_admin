import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Company } from './company.entity.js';
import { UserRole } from '../enums/app.enums.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 150, unique: true })
  email: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role', default: UserRole.COLLABORATOR })
  role: UserRole;

  @Column({ name: 'avatar_url', length: 255, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean;

  @Column({ name: 'verification_token', length: 255, nullable: true })
  verificationToken: string | null;

  @Column({ name: 'reset_password_token', length: 255, nullable: true })
  resetPasswordToken: string | null;

  @Column({ name: 'reset_password_expires', type: 'timestamptz', nullable: true })
  resetPasswordExpires: Date | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ length: 30, nullable: true })
  phone: string | null;

  @Column({ length: 50, nullable: true })
  matricule: string | null;

  @Column({ name: 'job_title', length: 100, nullable: true })
  jobTitle: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Company, (company) => company.users, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}