import { IsEnum, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { TaskPriority, TaskStatus } from '../../enums/app.enums.js';
import { TaskDateTime, TaskDescription, TaskTitle } from './task-fields.js';

export class UpdateTaskDto {
  @IsInt({ message: 'La version doit être un entier (celle reçue lors de la lecture).' })
  @Min(1, { message: 'La version est invalide.' })
  version: number;

  @ValidateIf((o: UpdateTaskDto) => o.title !== undefined)
  @TaskTitle()
  title?: string;

  @IsOptional()
  @TaskDescription()
  description?: string | null;

  @ValidateIf((o: UpdateTaskDto) => o.status !== undefined)
  @IsEnum(TaskStatus, {
    message: `Le statut doit être l'un de : ${Object.values(TaskStatus).join(', ')}.`,
  })
  status?: TaskStatus;

  @ValidateIf((o: UpdateTaskDto) => o.priority !== undefined)
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
}