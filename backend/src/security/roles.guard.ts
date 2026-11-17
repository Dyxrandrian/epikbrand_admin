import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../enums/app.enums.js';
import {
  AccessDeniedException,
  NotAuthenticatedException,
} from '../exceptions/app.exception.js';
import type { AuthenticatedRequest } from './authenticated-user.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ROLES_KEY } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    if (!roles || roles.length === 0) return true; // authentifié suffit

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new NotAuthenticatedException();

    if (!roles.includes(request.user.role)) throw new AccessDeniedException();
    return true;
  }
}