import { ValidationFailedException } from '../exceptions/index.js';

export type SortDirection = 'ASC' | 'DESC';
export type SortOrder = Record<string, SortDirection>;

/**
 * Transforme "-created_at,title" en { created_at: 'DESC', title: 'ASC' },
 * en refusant tout champ absent de la liste autorisée.
 */
export function parseSort(
  raw: string | undefined,
  allowed: readonly string[],
  fallback: SortOrder,
): SortOrder {
  if (!raw) return fallback;

  const order: SortOrder = {};
  const invalid: string[] = [];

  for (const part of raw.split(',')) {
    const desc = part.startsWith('-');
    const field = desc ? part.slice(1) : part;

    if (!allowed.includes(field)) {
      invalid.push(field);
      continue;
    }
    order[field] = desc ? 'DESC' : 'ASC';
  }

  if (invalid.length > 0) {
    throw new ValidationFailedException([
      {
        field: 'sort',
        reason: 'sortFieldNotAllowed',
        message: `Tri impossible sur : ${invalid.join(', ')}. Champs autorisés : ${allowed.join(', ')}.`,
      },
    ]);
  }
  return order;
}