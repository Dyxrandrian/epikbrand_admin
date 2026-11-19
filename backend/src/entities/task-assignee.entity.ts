import { Entity, PrimaryColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import type { Task } from './task.entity.js';
import type { User } from './user.entity.js';

@Index('idx_task_assignees_user', { synchronize: false })
@Entity('task_assignees')
export class TaskAssignee {
  @PrimaryColumn({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  @ManyToOne('Task', (task: any) => task.assignees, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ManyToOne('User', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}