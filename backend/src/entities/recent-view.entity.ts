import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { User } from './user.entity.js';

@Entity('recent_views')
export class RecentView {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'entity_type', type: 'varchar', length: 30 })
  entityType: string;

  @PrimaryColumn({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ name: 'viewed_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  viewedAt: Date;

  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}