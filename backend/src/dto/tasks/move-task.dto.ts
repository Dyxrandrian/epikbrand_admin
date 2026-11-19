import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { TaskStatus } from '../../enums/app.enums.js';

export class MoveTaskDto {
  @IsInt({ message: 'La version doit être un entier (celle reçue lors de la lecture).' })
  @Min(1, { message: 'La version est invalide.' })
  version: number;

  /** Colonne de destination. */
  @IsEnum(TaskStatus, {
    message: `Le statut doit être l'un de : ${Object.values(TaskStatus).join(', ')}.`,
  })
  status: TaskStatus;

  /** Carte qui précède la nôtre dans la colonne cible ; vide ou null = tout en haut. */
  @IsOptional()
  @IsUUID('all', { message: 'after_task_id doit être un UUID valide.' })
  after_task_id?: string | null;
}