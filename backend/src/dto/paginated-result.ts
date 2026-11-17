import type { PaginationQueryDto } from './pagination-query.dto.js';

export class PaginatedResult<T> {
  constructor(
    public readonly items: T[],
    public readonly total: number,
    public readonly page: number,
    public readonly perPage: number,
  ) {}

  get totalPages(): number {
    return Math.ceil(this.total / this.perPage);
  }

  /** Transforme les éléments (ex. entité -> DTO de sortie) en gardant la pagination. */
  map<U>(fn: (item: T) => U): PaginatedResult<U> {
    return new PaginatedResult(this.items.map(fn), this.total, this.page, this.perPage);
  }
}

/** Convertit page/per_page en paramètres skip/take pour TypeORM. */
export function toSkipTake(query: Pick<PaginationQueryDto, 'page' | 'per_page'>) {
  return {
    skip: (query.page - 1) * query.per_page,
    take: query.per_page,
  };
}