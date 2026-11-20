import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ExpenseRecurrence, ExpenseStatus } from '../../enums/app.enums.js';
import { DateOnlyField } from '../invoices/invoice-fields.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { splitCsv, toBoolean, trim } from '../transforms.js';

export class ExpenseListQueryDto extends PaginationQueryDto {
  /** Exemple : status=pending,paid */
  @IsOptional()
  @Transform(splitCsv)
  @IsEnum(ExpenseStatus, {
    each: true,
    message: `status doit contenir : ${Object.values(ExpenseStatus).join(', ')}.`,
  })
  status?: ExpenseStatus[];

  @IsOptional()
  @IsUUID('all', { message: 'category_id doit être un UUID valide.' })
  category_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id?: string;

  /** Admin et manager : dépenses d'une personne. */
  @IsOptional()
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id?: string;

  /** Recherche dans le nom du fournisseur (insensible à la casse et aux accents). */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'supplier doit être un texte.' })
  @MaxLength(150, { message: 'supplier ne peut pas dépasser 150 caractères.' })
  supplier?: string;

  /** Période de la date de dépense. */
  @IsOptional()
  @DateOnlyField()
  date_from?: string;

  @IsOptional()
  @DateOnlyField()
  date_to?: string;

  /** Période de l'échéance. */
  @IsOptional()
  @DateOnlyField()
  due_from?: string;

  @IsOptional()
  @DateOnlyField()
  due_to?: string;

  /** true : en attente avec échéance dépassée. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'overdue doit valoir true ou false.' })
  overdue?: boolean;

  /** true : modèles de récurrence ; false : les autres. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'recurring doit valoir true ou false.' })
  recurring?: boolean;

  @IsOptional()
  @IsEnum(ExpenseRecurrence, {
    message: `recurrence doit être l'une de : ${Object.values(ExpenseRecurrence).join(', ')}.`,
  })
  recurrence?: ExpenseRecurrence;

  /** Occurrences générées par ce modèle de récurrence. */
  @IsOptional()
  @IsUUID('all', { message: 'generated_from doit être un UUID valide.' })
  generated_from?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'has_receipt doit valoir true ou false.' })
  has_receipt?: boolean;

  /** true : notes de frais en attente de validation. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'awaiting_validation doit valoir true ou false.' })
  awaiting_validation?: boolean;
}