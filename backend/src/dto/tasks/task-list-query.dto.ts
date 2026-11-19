import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import { TaskPriority, TaskStatus } from '../../enums/app.enums.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { toBoolean } from '../transforms.js';
import { QueryDateTime } from './task-fields.js';

const DAY_MESSAGE = 'La date doit être au format AAAA-MM-JJ.';
const statusMessage = `Le statut doit être l'un de : ${Object.values(TaskStatus).join(', ')}.`;
const priorityMessage = `La priorité doit être l'une de : ${Object.values(TaskPriority).join(', ')}.`;

export class TaskListQueryDto extends PaginationQueryDto {
  /** exclude (défaut) : actives seulement ; only : archivées ; include : les deux (admin, manager). */
  @IsOptional()
  @IsIn(['exclude', 'include', 'only'], {
    message: 'archived doit valoir exclude, include ou only.',
  })
  archived?: 'exclude' | 'include' | 'only';

  @IsOptional()
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id?: string;

  /** Sous-tâches d'une tâche donnée. */
  @IsOptional()
  @IsUUID('all', { message: 'parent_task_id doit être un UUID valide.' })
  parent_task_id?: string;

  /** true : tâches de premier niveau ; false : sous-tâches seulement. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'top_level doit valoir true ou false.' })
  top_level?: boolean;

  @IsOptional()
  @IsEnum(TaskStatus, { message: statusMessage })
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority, { message: priorityMessage })
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID('all', { message: 'label_id doit être un UUID valide.' })
  label_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'assignee_id doit être un UUID valide.' })
  assignee_id?: string;

  /** true : sans responsable ; false : avec au moins un responsable. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'unassigned doit valoir true ou false.' })
  unassigned?: boolean;

  /** true : échéance dépassée et tâche non terminée. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'overdue doit valoir true ou false.' })
  overdue?: boolean;

  /** Échéance (date locale de l'entreprise) à partir de ce jour inclus. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  due_from?: string;

  /** Échéance (date locale de l'entreprise) jusqu'à ce jour inclus. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  due_to?: string;
}

export class TaskKanbanQueryDto {
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id: string;

  @IsOptional()
  @IsUUID('all', { message: 'assignee_id doit être un UUID valide.' })
  assignee_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'label_id doit être un UUID valide.' })
  label_id?: string;

  @IsOptional()
  @IsEnum(TaskPriority, { message: priorityMessage })
  priority?: TaskPriority;
}

export class TaskCalendarQueryDto {
  /** Début de la plage visible (horodatage avec fuseau). */
  @QueryDateTime()
  from: string;

  /** Fin de la plage visible (horodatage avec fuseau). */
  @QueryDateTime()
  to: string;

  @IsOptional()
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'assignee_id doit être un UUID valide.' })
  assignee_id?: string;
}

export class TaskMineQueryDto {
  /** true : inclut aussi les tâches terminées (groupe « completed »). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'include_done doit valoir true ou false.' })
  include_done?: boolean;
}