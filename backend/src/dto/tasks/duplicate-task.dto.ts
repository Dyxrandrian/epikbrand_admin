import { ValidateIf } from 'class-validator';
import { TaskTitle } from './task-fields.js';

export class DuplicateTaskDto {
  /** Par défaut : « Copie de <titre> ». */
  @ValidateIf((o: DuplicateTaskDto) => o.title !== undefined)
  @TaskTitle()
  title?: string;
}