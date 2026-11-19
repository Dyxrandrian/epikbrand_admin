import { IsUUID, ValidateIf } from 'class-validator';
import { ProjectTitle } from './project-fields.js';

export class DuplicateProjectDto {
  /** Par défaut : « Copie de <titre> ». */
  @ValidateIf((o: DuplicateProjectDto) => o.title !== undefined)
  @ProjectTitle()
  title?: string;

  /** Par défaut : le client du projet d'origine. */
  @ValidateIf((o: DuplicateProjectDto) => o.client_id !== undefined)
  @IsUUID('all', { message: 'client_id doit être un UUID valide.' })
  client_id?: string;
}