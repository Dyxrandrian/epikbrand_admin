import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TaskPriority, TaskStatus } from '../../enums/app.enums.js';
import { TaskDateTime, TaskDescription, TaskTitle, UuidArray } from './task-fields.js';

export class CreateTaskDto {
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id: string;

  /** Crée une sous-tâche : le parent doit être une tâche de premier niveau du même projet. */
  @IsOptional()
  @IsUUID('all', { message: 'parent_task_id doit être un UUID valide.' })
  parent_task_id?: string | null;

  @TaskTitle()
  title: string;

  @IsOptional()
  @TaskDescription()
  description?: string | null;

  @IsOptional()
  @IsEnum(TaskStatus, {
    message: `Le statut doit être l'un de : ${Object.values(TaskStatus).join(', ')}.`,
  })
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority, {
    message: `La priorité doit être l'une de : ${Object.values(TaskPriority).join(', ')}.`,
  })
  priority?: TaskPriority;

  @IsOptional()
  @TaskDateTime()
  start_date?: string | null;

  @IsOptional()
  @TaskDateTime()
  end_date?: string | null;

  @IsOptional()
  @UuidArray('assignee_ids', 20)
  assignee_ids?: string[];

  @IsOptional()
  @UuidArray('label_ids', 20)
  label_ids?: string[];
}