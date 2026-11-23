import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { RequestStatus } from '../../enums/app.enums.js';
import { DateOnlyField, TextField } from '../invoices/invoice-fields.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { splitCsv } from '../transforms.js';

export class CreateLeaveRequestDto {
  @IsUUID('all', { message: 'leave_type_id doit être un UUID valide.' })
  leave_type_id: string;

  @DateOnlyField()
  start_date: string;

  @DateOnlyField()
  end_date: string;

  /** true : le premier jour ne compte que l'après-midi. */
  @IsOptional()
  @IsBoolean({ message: 'start_half_day doit valoir true ou false.' })
  start_half_day?: boolean;

  /** true : le dernier jour ne compte que le matin. */
  @IsOptional()
  @IsBoolean({ message: 'end_half_day doit valoir true ou false.' })
  end_half_day?: boolean;

  @IsOptional()
  @TextField('Le motif', 2000)
  reason?: string | null;
}

export class LeaveListQueryDto extends PaginationQueryDto {
  /** Exemple : status=pending,approved */
  @IsOptional()
  @Transform(splitCsv)
  @IsEnum(RequestStatus, {
    each: true,
    message: `status doit contenir : ${Object.values(RequestStatus).join(', ')}.`,
  })
  status?: RequestStatus[];

  /** Admin et manager : demandes d'une personne. */
  @IsOptional()
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'leave_type_id doit être un UUID valide.' })
  leave_type_id?: string;

  /** Période : demandes qui touchent l'intervalle [from, to]. */
  @IsOptional()
  @DateOnlyField()
  from?: string;

  @IsOptional()
  @DateOnlyField()
  to?: string;
}

export class LeaveCalendarQueryDto {
  @IsOptional()
  @IsIn(['month', 'week'], { message: 'view doit valoir month ou week.' })
  view?: 'month' | 'week';

  /** Un jour quelconque de la période affichée (par défaut : aujourd'hui). */
  @IsOptional()
  @DateOnlyField()
  date?: string;
}

export class LeaveBalanceQueryDto {
  /** Par défaut : l'année en cours. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'year doit être un entier.' })
  @Min(2000, { message: 'year est trop ancien.' })
  @Max(2100, { message: 'year est trop lointain.' })
  year?: number;

  /** Admin et manager : soldes d'une personne. */
  @IsOptional()
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id?: string;
}

export class SetLeaveBalanceDto {
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id: string;

  @IsUUID('all', { message: 'leave_type_id doit être un UUID valide.' })
  leave_type_id: string;

  @IsInt({ message: 'year doit être un entier.' })
  @Min(2000, { message: 'year est trop ancien.' })
  @Max(2100, { message: 'year est trop lointain.' })
  year: number;

  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 1 },
    { message: 'Le quota doit être un nombre avec au plus 1 décimale.' },
  )
  @Min(0, { message: 'Le quota ne peut pas être négatif.' })
  @Max(366, { message: 'Le quota ne peut pas dépasser 366 jours.' })
  allowance_days: number;
}