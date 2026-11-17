import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import type { Task } from './task.entity.js';
import type { Label } from './label.entity.js';

@Entity('task_labels')
export class TaskLabel {
  @PrimaryColumn({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @PrimaryColumn({ name: 'label_id', type: 'uuid' })
  labelId: string;

  @ManyToOne('Task', (task: any) => task.taskLabels, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ManyToOne('Label', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'label_id' })
  label: Label;
}