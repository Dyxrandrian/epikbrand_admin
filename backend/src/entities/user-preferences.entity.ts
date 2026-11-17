import { Entity, PrimaryColumn, Column, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity.js';

@Entity('user_preferences')
export class UserPreferences {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  shortcuts: Record<string, string>;

  @Column({ name: 'notification_prefs', type: 'jsonb', default: () => "'{}'" })
  notificationPrefs: Record<string, boolean>;

  @Column({ type: 'varchar', length: 10, default: 'fr' })
  locale: string;

  @Column({ type: 'varchar', length: 10, default: 'system' })
  theme: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
