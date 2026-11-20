import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MediaPurpose } from '../../enums/app.enums.js';
import { emptyToUndefined } from '../transforms.js';

export class UploadFileDto {
  /** Par défaut : attachment. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(MediaPurpose, {
    message: `purpose doit être l'un de : ${Object.values(MediaPurpose).join(', ')}.`,
  })
  purpose?: MediaPurpose;

  /** Pièce jointe : exactement un des trois champs ci-dessous. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'task_id doit être un UUID valide.' })
  task_id?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID('all', { message: 'article_id doit être un UUID valide.' })
  article_id?: string;
}