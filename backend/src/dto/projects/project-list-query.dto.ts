import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ProjectStatus } from '../../enums/app.enums.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';

export const DEADLINE_FILTERS = ['overdue', 'this_week', 'this_month'] as const;
export type DeadlineFilter = (typeof DEADLINE_FILTERS)[number];

export class ProjectListQueryDto extends PaginationQueryDto {
  /** exclude (défaut) : actifs seulement ; only : archivés seulement ; include : les deux. */
  @IsOptional()
  @IsIn(['exclude', 'include', 'only'], {
    message: 'archived doit valoir exclude, include ou only.',
  })
  archived?: 'exclude' | 'include' | 'only';

  @IsOptional()
  @IsEnum(ProjectStatus, {
    message: `status doit être l'un de : ${Object.values(ProjectStatus).join(', ')}.`,
  })
  status?: ProjectStatus;

  @IsOptional()
  @IsUUID('all', { message: 'client_id doit être un UUID valide.' })
  client_id?: string;

  /** overdue : échéance passée (hors livrés). this_week : lundi-dimanche. this_month : mois en cours. */
  @IsOptional()
  @IsIn([...DEADLINE_FILTERS], {
    message: `deadline doit valoir : ${DEADLINE_FILTERS.join(', ')}.`,
  })
  deadline?: DeadlineFilter;
}