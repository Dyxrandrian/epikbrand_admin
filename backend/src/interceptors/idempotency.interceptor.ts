import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { catchError, from, map, mergeMap, of, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../security/authenticated-user.js';
import { IdempotencyService } from '../services/idempotency/idempotency.service.js';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    // L'en-tête est facultatif : sans lui, la requête s'exécute normalement
    const rawKey = request.headers['idempotency-key'];
    if (rawKey === undefined || !request.user) return next.handle();

    const key = this.idempotency.parseKey(rawKey);
    const scope = { companyId: request.user.companyId, userId: request.user.id };
    const hash = this.idempotency.hashRequest(request.method, request.originalUrl, request.body);

    const begin = await this.idempotency.begin(scope, key, hash);
    if (begin.kind === 'replay') {
      response.setHeader('Idempotent-Replayed', 'true');
      return of(begin.body);
    }

    return next.handle().pipe(
      mergeMap((value) =>
        from(this.idempotency.complete(scope, begin.id, value)).pipe(map(() => value)),
      ),
      // Échec : la clé est libérée, le client peut réessayer avec la même
      catchError((error: unknown) =>
        from(this.idempotency.abandon(scope, begin.id)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }
}