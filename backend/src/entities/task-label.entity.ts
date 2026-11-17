import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Task } from './task.entity.js';
import { Label } from './label.entity.js';

@Entity('task_labels')
export class TaskLabel {
  @PrimaryColumn({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @PrimaryColumn({ name: 'label_id', type: 'uuid' })
  labelId: string;

  @ManyToOne(() => Task, (task) => task.taskLabels, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @ManyToOne(() => Label, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'label_id' })
  label: Label;
}
