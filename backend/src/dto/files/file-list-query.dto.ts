import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { MediaPurpose } from '../../enums/app.enums.js';
import { FileCategory } from '../../enums/file.enums.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { toBoolean } from '../transforms.js';

export class FileCategoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(FileCategory, {
    message: `category doit être l'un de : ${Object.values(FileCategory).join(', ')}.`,
  })
  category?: FileCategory;
}

export class FileListQueryDto extends FileCategoryQueryDto {
  @IsOptional()
  @IsIn([MediaPurpose.ATTACHMENT, MediaPurpose.RECEIPT], {
    message: 'purpose doit valoir attachment ou receipt.',
  })
  purpose?: MediaPurpose;

  @IsOptional()
  @IsUUID('all', { message: 'uploaded_by doit être un UUID valide.' })
  uploaded_by?: string;
}

export class FileContentQueryDto {
  /** true : affichage dans le navigateur (images et PDF seulement), sinon téléchargement. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'inline doit valoir true ou false.' })
  inline?: boolean;
}