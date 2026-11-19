import { IsInt, IsOptional, IsUUID, Min, ValidateIf } from 'class-validator';
import {
  ProjectBudget,
  ProjectDeadline,
  ProjectDescription,
  ProjectTitle,
} from './project-fields.js';

export class UpdateProjectDto {
  @IsInt({ message: 'La version doit être un entier (celle reçue lors de la lecture).' })
  @Min(1, { message: 'La version est invalide.' })
  version: number;

  @ValidateIf((o: UpdateProjectDto) => o.client_id !== undefined)
  @IsUUID('all', { message: 'client_id doit être un UUID valide.' })
  client_id?: string;

  @ValidateIf((o: UpdateProjectDto) => o.title !== undefined)
  @ProjectTitle()
  title?: string;

  @IsOptional()
  @ProjectDescription()
  description?: string | null;

  // Le budget ne peut pas être vidé : null est refusé
  @ValidateIf((o: UpdateProjectDto) => o.budget_ht !== undefined)
  @ProjectBudget()
  budget_ht?: number;

  @IsOptional()
  @ProjectDeadline()
  deadline?: string | null;
}