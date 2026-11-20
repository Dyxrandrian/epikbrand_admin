import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

/** Rend une route sûre contre les doubles clics et les réessais (en-tête Idempotency-Key). */
export const Idempotent = () => applyDecorators(UseInterceptors(IdempotencyInterceptor));