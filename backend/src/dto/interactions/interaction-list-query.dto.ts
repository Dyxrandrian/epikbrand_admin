import { IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { InteractionType } from '../../enums/app.enums.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';

export class InteractionFiltersDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(InteractionType, {
    message: `type doit être l'un de : ${Object.values(InteractionType).join(', ')}.`,
  })
  type?: InteractionType;

  /** Auteur de l'interaction. */
  @IsOptional()
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id?: string;

  /** Une date seule (2026-11-01) vaut minuit UTC ; envoyez un horodatage complet pour être précis. */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from doit être une date ISO 8601.' })
  from?: string;

  /** Une date seule inclut toute la journée (UTC). */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to doit être une date ISO 8601.' })
  to?: string;
}

export class InteractionListQueryDto extends InteractionFiltersDto {
  @IsOptional()
  @IsUUID('all', { message: 'client_id doit être un UUID valide.' })
  client_id?: string;
}