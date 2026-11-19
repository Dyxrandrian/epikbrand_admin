import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsIn, IsUUID, ValidateIf } from 'class-validator';
import { TaskStatus } from '../../enums/app.enums.js';
import { UuidArray } from './task-fields.js';

export const BULK_ACTIONS = ['status', 'assign', 'add_labels', 'remove_labels', 'archive'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export class BulkTasksDto {
  @IsArray({ message: 'task_ids doit être une liste.' })
  @ArrayMinSize(1, { message: 'task_ids doit contenir au moins une tâche.' })
  @ArrayMaxSize(100, { message: 'task_ids ne peut pas contenir plus de 100 tâches.' })
  @ArrayUnique({ message: 'task_ids ne doit pas contenir de doublons.' })
  @IsUUID('all', { each: true, message: 'task_ids doit contenir des UUID valides.' })
  task_ids: string[];

  @IsIn([...BULK_ACTIONS], { message: `action doit valoir : ${BULK_ACTIONS.join(', ')}.` })
  action: BulkAction;

  /** action = status */
  @ValidateIf((o: BulkTasksDto) => o.action === 'status')
  @IsEnum(TaskStatus, {
    message: `Le statut doit être l'un de : ${Object.values(TaskStatus).join(', ')}.`,
  })
  status?: TaskStatus;

  /** action = assign : REMPLACE les responsables (liste vide = retirer tout le monde). */
  @ValidateIf((o: BulkTasksDto) => o.action === 'assign')
  @UuidArray('assignee_ids', 20)
  assignee_ids?: string[];

  /** action = add_labels ou remove_labels */
  @ValidateIf((o: BulkTasksDto) => o.action === 'add_labels' || o.action === 'remove_labels')
  @UuidArray('label_ids', 20)
  @ArrayMinSize(1, { message: 'label_ids doit contenir au moins une étiquette.' })
  label_ids?: string[];
}