import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { NotAuthenticatedException } from '../exceptions/app.exception.js';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from './authenticated-user.js';

export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new NotAuthenticatedException();
    return field ? request.user[field] : request.user;
  },
);