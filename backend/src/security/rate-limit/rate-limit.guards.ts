import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../authenticated-user.js';
import { normalizeIp } from '../ip.js';
import { RATE_LIMIT_KEY } from './rate-limit.decorator.js';
import type { RateLimitRule } from './rate-limit.decorator.js';
import { RateLimitService } from './rate-limit.service.js';

function positiveInt(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function routeId(context: ExecutionContext): string {
  return `${context.getClass().name}.${context.getHandler().name}`;
}

/** Passe AVANT l'authentification : limite globale par IP + limites `ip` propres aux routes. */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly globalRule: RateLimitRule;

  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
    config: ConfigService,
  ) {
    this.globalRule = {
      limit: positiveInt(config.get('RATE_LIMIT_IP_PER_MINUTE'), 600),
      windowSeconds: 60,
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const ip = normalizeIp(request.ip) ?? 'inconnue';

    await this.limits.consume(`ip:global:${ip}`, this.globalRule, response);

    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (rule && (rule.scope ?? 'ip') === 'ip') {
      await this.limits.consume(`ip:${routeId(context)}:${ip}`, rule, response);
    }
    return true;
  }
}

/** Passe APRÈS l'authentification : limite globale par utilisateur + limites `user` des routes. */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  private readonly globalRule: RateLimitRule;

  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
    config: ConfigService,
  ) {
    this.globalRule = {
      limit: positiveInt(config.get('RATE_LIMIT_USER_PER_MINUTE'), 300),
      windowSeconds: 60,
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    // Routes publiques : pas d'utilisateur, déjà couvertes par la limite par IP
    if (!request.user) return true;

    await this.limits.consume(`user:global:${request.user.id}`, this.globalRule, response);

    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (rule?.scope === 'user') {
      await this.limits.consume(`user:${routeId(context)}:${request.user.id}`, rule, response);
    }
    return true;
  }
}