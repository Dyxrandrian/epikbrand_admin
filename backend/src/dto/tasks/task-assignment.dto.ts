import { ArrayMinSize } from 'class-validator';
import { UuidArray } from './task-fields.js';

export class AddAssigneesDto {
  @UuidArray('user_ids', 20)
  @ArrayMinSize(1, { message: 'user_ids doit contenir au moins un utilisateur.' })
  user_ids: string[];
}

export class SetLabelsDto {
  /** Liste complète des étiquettes de la tâche (vide = les retirer toutes). */
  @UuidArray('label_ids', 20)
  label_ids: string[];
}