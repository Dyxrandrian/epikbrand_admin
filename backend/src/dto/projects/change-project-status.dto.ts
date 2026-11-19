import { IsEnum, IsInt, Min } from 'class-validator';
import { ProjectStatus } from '../../enums/app.enums.js';

export class ChangeProjectStatusDto {
  @IsInt({ message: 'La version doit être un entier (celle reçue lors de la lecture).' })
  @Min(1, { message: 'La version est invalide.' })
  version: number;

  @IsEnum(ProjectStatus, {
    message: `Le statut doit être l'un de : ${Object.values(ProjectStatus).join(', ')}.`,
  })
  status: ProjectStatus;
}