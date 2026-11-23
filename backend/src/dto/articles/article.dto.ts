import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { normalizeName, toBoolean } from '../transforms.js';

export const MAX_TOP_LEVEL_BLOCKS = 2000;

const ArticleTitle = () =>
  applyDecorators(
    Transform(normalizeName),
    IsString({ message: 'Le titre doit être un texte.' }),
    IsNotEmpty({ message: 'Le titre est obligatoire.' }),
    MaxLength(200, { message: 'Le titre ne peut pas dépasser 200 caractères.' }),
  );

/** Liste de blocs BlockNote (editor.document). La structure est validée en détail par le service. */
const ArticleContent = () =>
  applyDecorators(
    IsArray({ message: 'content doit être une liste de blocs BlockNote.' }),
    ArrayMaxSize(MAX_TOP_LEVEL_BLOCKS, {
      message: `content ne peut pas contenir plus de ${MAX_TOP_LEVEL_BLOCKS} blocs.`,
    }),
    IsObject({ each: true, message: 'Chaque bloc de content doit être un objet.' }),
  );

export class CreateArticleDto {
  @ArticleTitle()
  title: string;

  @IsUUID('all', { message: 'section_id doit être un UUID valide.' })
  section_id: string;

  @IsOptional()
  @IsUUID('all', { message: 'category_id doit être un UUID valide.' })
  category_id?: string | null;

  /** Sans image : elles se joignent une fois l'article créé. Par défaut : article vide. */
  @IsOptional()
  @ArticleContent()
  content?: unknown[];

  /** false : ne pas notifier les utilisateurs. */
  @IsOptional()
  @IsBoolean({ message: 'notify doit valoir true ou false.' })
  notify?: boolean;
}

export class UpdateArticleDto {
  @IsInt({ message: 'La version doit être un entier (celle reçue lors de la lecture).' })
  @Min(1, { message: 'La version est invalide.' })
  version: number;

  @ValidateIf((o: UpdateArticleDto) => o.title !== undefined)
  @ArticleTitle()
  title?: string;

  @ValidateIf((o: UpdateArticleDto) => o.section_id !== undefined)
  @IsUUID('all', { message: 'section_id doit être un UUID valide.' })
  section_id?: string;

  /** null retire la catégorie. */
  @IsOptional()
  @IsUUID('all', { message: 'category_id doit être un UUID valide.' })
  category_id?: string | null;

  @ValidateIf((o: UpdateArticleDto) => o.content !== undefined)
  @ArticleContent()
  content?: unknown[];
}

export class RestoreVersionDto {
  /** Version actuelle de l'article (verrouillage optimiste). */
  @IsInt({ message: 'La version doit être un entier (celle reçue lors de la lecture).' })
  @Min(1, { message: 'La version est invalide.' })
  version: number;
}

export class ArticleListQueryDto extends PaginationQueryDto {
  /** exclude (défaut) : actifs seulement ; only : archivés ; include : les deux (admin, manager). */
  @IsOptional()
  @IsIn(['exclude', 'include', 'only'], {
    message: 'archived doit valoir exclude, include ou only.',
  })
  archived?: 'exclude' | 'include' | 'only';

  @IsOptional()
  @IsUUID('all', { message: 'section_id doit être un UUID valide.' })
  section_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'category_id doit être un UUID valide.' })
  category_id?: string;

  /** true : articles sans catégorie. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'uncategorized doit valoir true ou false.' })
  uncategorized?: boolean;

  /** Auteur de la dernière modification. */
  @IsOptional()
  @IsUUID('all', { message: 'updated_by doit être un UUID valide.' })
  updated_by?: string;
}