import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { TooManyRequestsException } from '../../exceptions/index.js';
import type { RateLimitRule } from './rate-limit.decorator.js';
import { RateLimitStore } from './rate-limit.store.js';

@Injectable()
export class RateLimitService {
  constructor(private readonly store: RateLimitStore) {}

  /** Compte une requête ; lève un 429 avec l'en-tête Retry-After si la limite est dépassée. */
  async consume(key: string, rule: RateLimitRule, response: Response): Promise<void> {
    const hit = await this.store.hit(key, rule.windowSeconds * 1000);
    if (hit.count <= rule.limit) return;

    const retryAfter = Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000));
    response.setHeader('Retry-After', String(retryAfter));
    throw new TooManyRequestsException(retryAfter);
  }
}