import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page doit être un entier.' })
  @Min(1, { message: 'page doit être supérieur ou égal à 1.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'per_page doit être un entier.' })
  @Min(1, { message: 'per_page doit être supérieur ou égal à 1.' })
  @Max(MAX_PAGE_SIZE, {
    message: `per_page ne peut pas dépasser ${MAX_PAGE_SIZE}.`,
  })
  per_page: number = DEFAULT_PAGE_SIZE;

  /** Recherche texte (insensible à la casse et aux accents, appliquée par le repository). */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString({ message: 'q doit être un texte.' })
  @MaxLength(200, { message: 'q ne peut pas dépasser 200 caractères.' })
  q?: string;

  /** Exemple : sort=-created_at,title (le "-" signifie décroissant). */
  @IsOptional()
  @IsString({ message: 'sort doit être un texte.' })
  @Matches(/^-?[a-z0-9_]+(,-?[a-z0-9_]+)*$/, {
    message: 'sort doit ressembler à : -created_at,title',
  })
  sort?: string;

  /** Exemple : include=client,assignees (la liste autorisée dépend de la ressource). */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v: string) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray({ message: 'include doit être une liste séparée par des virgules.' })
  @IsString({ each: true })
  include?: string[];
}