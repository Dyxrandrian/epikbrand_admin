import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { normalizeIp } from './ip.js';

export interface ClientMetadata {
  ip: string | null;
  userAgent: string | null;
}

export const ClientMeta = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ClientMetadata => {
    const request = context.switchToHttp().getRequest<Request>();
    const userAgent = request.headers['user-agent'];
    return {
      ip: normalizeIp(request.ip),
      userAgent: userAgent ? userAgent.slice(0, 255) : null,
    };
  },
);