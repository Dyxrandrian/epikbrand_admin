import { rm } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { finalize } from 'rxjs';
import type { Observable } from 'rxjs';

@Injectable()
export class UploadCleanupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ file?: { path?: string } }>();
    return next.handle().pipe(
      finalize(() => {
        const path = request.file?.path;
        if (path) void rm(path, { force: true }).catch(() => undefined);
      }),
    );
  }
}