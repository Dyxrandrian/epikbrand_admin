import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, VersionColumn, Check, Index } from 'typeorm';
import type { Company } from './company.entity.js';
import type { Project } from './project.entity.js';
import type { User } from './user.entity.js';
import type { TaskAssignee } from './task-assignee.entity.js';
import type { TaskLabel } from './task-label.entity.js';
import type { TaskComment } from './task-comment.entity.js';
import { TaskStatus, TaskPriority } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Check('chk_task_dates', '"end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date"')
@Index('idx_search_tasks', { synchronize: false })
@Index('idx_tasks_project', { synchronize: false })
@Index('idx_tasks_company_status', { synchronize: false })
@Index('idx_tasks_company_end', { synchronize: false })
@Index('idx_tasks_parent', { synchronize: false })
@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  /** Sous-tâches */
  @Column({ name: 'parent_task_id', type: 'uuid', nullable: true })
  parentTaskId: string | null;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: TaskStatus, enumName: 'task_status', default: TaskStatus.TODO })
  status: TaskStatus;

  @Column({ type: 'enum', enum: TaskPriority, enumName: 'task_priority', default: TaskPriority.MEDIUM })
  priority: TaskPriority;

  /** Ordre manuel dans la colonne Kanban */
  @Column({ type: 'numeric', precision: 20, scale: 10, default: 0, transformer: numericTransformer })
  position: number;

  @Column({ name: 'start_date', type: 'timestamptz', nullable: true })
  startDate: Date | null;

  @Column({ name: 'end_date', type: 'timestamptz', nullable: true })
  endDate: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @VersionColumn()
  version: number;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('Project', (project: any) => project.tasks, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @ManyToOne('Task', (task: any) => task.subtasks, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_task_id' })
  parentTask: Task | null;

  @OneToMany('Task', (task: any) => task.parentTask)
  subtasks: Task[];

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy: User | null;

  @OneToMany('TaskAssignee', (assignee: any) => assignee.task)
  assignees: TaskAssignee[];

  @OneToMany('TaskLabel', (taskLabel: any) => taskLabel.task)
  taskLabels: TaskLabel[];

  @OneToMany('TaskComment', (comment: any) => comment.task)
  comments: TaskComment[];
}