import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../security/authenticated-user.js';
import { normalizeIp } from '../security/ip.js';
import { RequestContext } from '../security/request-context.js';
import type { RequestContextStore } from '../security/request-context.js';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userAgent = request.headers['user-agent'];

    const store: RequestContextStore = {
      ip: normalizeIp(request.ip),
      userAgent: userAgent ? userAgent.slice(0, 255) : null,
      userId: request.user?.id,
      companyId: request.user?.companyId,
    };

    return new Observable<unknown>((subscriber) =>
      RequestContext.run(store, () => next.handle().subscribe(subscriber)),
    );
  }
}