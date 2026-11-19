import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { toBoolean } from '../transforms.js';

export class ClientListQueryDto extends PaginationQueryDto {
  /** exclude (défaut) : actifs seulement ; only : archivés seulement ; include : les deux. */
  @IsOptional()
  @IsIn(['exclude', 'include', 'only'], {
    message: 'archived doit valoir exclude, include ou only.',
  })
  archived?: 'exclude' | 'include' | 'only';

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'has_projects doit valoir true ou false.' })
  has_projects?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'has_unpaid_invoices doit valoir true ou false.' })
  has_unpaid_invoices?: boolean;
}