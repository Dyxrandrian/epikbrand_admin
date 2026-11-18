import { SetMetadata } from '@nestjs/common';

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
  /** `ip` (défaut) : compté avant l'authentification. `user` : compté après, par utilisateur. */
  scope?: 'ip' | 'user';
}

export const RATE_LIMIT_KEY = 'rateLimit';

/** Limite propre à une route, en plus des limites globales. */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);