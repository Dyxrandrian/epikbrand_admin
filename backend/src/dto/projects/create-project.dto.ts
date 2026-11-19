import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ProjectStatus } from '../../enums/app.enums.js';
import {
  ProjectBudget,
  ProjectDeadline,
  ProjectDescription,
  ProjectTitle,
} from './project-fields.js';

export class CreateProjectDto {
  @IsUUID('all', { message: 'client_id doit être un UUID valide.' })
  client_id: string;

  @ProjectTitle()
  title: string;

  @IsOptional()
  @ProjectDescription()
  description?: string | null;

  /** 0 par défaut. */
  @IsOptional()
  @ProjectBudget()
  budget_ht?: number;

  @IsOptional()
  @ProjectDeadline()
  deadline?: string | null;

  /** Un nouveau projet n'a pas de tâche : il ne peut démarrer qu'en attente ou en cours. */
  @IsOptional()
  @IsIn([ProjectStatus.PENDING, ProjectStatus.ONGOING], {
    message: 'Le statut initial doit être pending ou ongoing.',
  })
  status?: ProjectStatus;
}