import { Injectable, StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';
import { PaginatedResult } from '../dto/paginated-result.js';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        // 204 (suppression) : pas de corps
        if (value === undefined) return value;

        // Fichiers (PDF de facture, export CSV…) : on ne touche à rien
        if (value instanceof StreamableFile) return value;

        if (value instanceof PaginatedResult) {
          return {
            data: value.items,
            meta: {
              total: value.total,
              page: value.page,
              per_page: value.perPage,
              total_pages: value.totalPages,
            },
          };
        }

        return { data: value };
      }),
    );
  }
}