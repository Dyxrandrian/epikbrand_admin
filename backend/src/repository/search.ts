import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

const MAX_SEARCH_WORDS = 5;

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function searchWords(q: string | undefined): string[] {
  if (!q) return [];
  return q.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_WORDS);
}

/**
 * `textExpression` : expression SQL (texte brut, sans accents ni minuscules appliqués).
 * Elle doit être identique à celle de l'index correspondant pour qu'il serve.
 */
export function applyWordSearch<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  textExpression: string,
  q: string | undefined,
): void {
  searchWords(q).forEach((word, index) => {
    const param = `search_${index}`;
    qb.andWhere(
      `immutable_unaccent(lower(${textExpression})) LIKE '%' || immutable_unaccent(lower(CAST(:${param} AS text))) || '%'`,
      { [param]: escapeLike(word) },
    );
  });
}

/**
 * Recherche qui s'appuie sur les index idx_search_* de PostSchema.
 * `column` : la colonne indexée, entre guillemets (ex. "project"."title").
 */
export function applyIndexedWordSearch<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  column: string,
  q: string | undefined,
): void {
  searchWords(q).forEach((word, index) => {
    const param = `isearch_${index}`;
    qb.andWhere(
      `f_unaccent(${column}) ILIKE '%' || f_unaccent(CAST(:${param} AS text)) || '%'`,
      { [param]: escapeLike(word) },
    );
  });
}