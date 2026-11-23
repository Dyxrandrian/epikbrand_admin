import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RequestStatus } from '../../enums/app.enums.js';
import { DateOnlyField, TextField } from '../invoices/invoice-fields.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { normalizeName, splitCsv } from '../transforms.js';

export class CreateTrainingRequestDto {
  @Transform(normalizeName)
  @IsString({ message: 'Le nom de la formation doit être un texte.' })
  @IsNotEmpty({ message: 'Le nom de la formation est obligatoire.' })
  @MaxLength(200, { message: 'Le nom de la formation ne peut pas dépasser 200 caractères.' })
  training_name: string;

  @IsOptional()
  @TextField('La description', 5000)
  description?: string | null;
}

export class TrainingListQueryDto extends PaginationQueryDto {
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

  /** Période de la date de demande (fuseau de l'entreprise). */
  @IsOptional()
  @DateOnlyField()
  from?: string;

  @IsOptional()
  @DateOnlyField()
  to?: string;
}

export class TrainingSummaryQueryDto {
  /** Période de la date de décision (fuseau de l'entreprise) ; absente = sans limite. */
  @IsOptional()
  @DateOnlyField()
  from?: string;

  @IsOptional()
  @DateOnlyField()
  to?: string;
}