import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { trim } from '../transforms.js';
import { UuidArray } from './task-fields.js';

export class CreateTaskCommentDto {
  @Transform(trim)
  @IsString({ message: 'Le commentaire doit être un texte.' })
  @IsNotEmpty({ message: 'Le commentaire est obligatoire.' })
  @MaxLength(5000, { message: 'Le commentaire ne peut pas dépasser 5000 caractères.' })
  content: string;

  /** Personnes citées (chacune doit pouvoir voir la tâche). */
  @IsOptional()
  @UuidArray('mentioned_user_ids', 20)
  mentioned_user_ids?: string[];
}

export class UpdateTaskCommentDto {
  @ValidateIf((o: UpdateTaskCommentDto) => o.content !== undefined)
  @Transform(trim)
  @IsString({ message: 'Le commentaire doit être un texte.' })
  @IsNotEmpty({ message: 'Le commentaire ne peut pas être vide.' })
  @MaxLength(5000, { message: 'Le commentaire ne peut pas dépasser 5000 caractères.' })
  content?: string;

  /** Si fourni, remplace la liste des mentions. */
  @IsOptional()
  @UuidArray('mentioned_user_ids', 20)
  mentioned_user_ids?: string[];
}