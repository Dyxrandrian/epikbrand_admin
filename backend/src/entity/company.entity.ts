import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { User } from './user.entity.js';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ name: 'logo_url', length: 255, nullable: true })
  logoUrl: string | null;

  @Column({ name: 'cover_url', length: 255, nullable: true })
  coverUrl: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'website_url', length: 255, nullable: true })
  websiteUrl: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ length: 30, nullable: true })
  phone: string | null;

  @Column({ name: 'tax_info', length: 100, nullable: true })
  taxInfo: string | null;

  @Column({ length: 50, nullable: true })
  nif: string | null;

  @Column({ length: 50, nullable: true })
  stat: string | null;

  @Column({ length: 50, nullable: true })
  rcs: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => User, (user) => user.company)
  users: User[];
}