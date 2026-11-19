import { UserRole } from '../enums/app.enums.js';
import type { AuthenticatedUser } from './authenticated-user.js';

/** Vrai pour un admin ou un manager, faux pour un collaborateur. */
export const isManagerOrAdmin = (user: Pick<AuthenticatedUser, 'role'>): boolean =>
  user.role !== UserRole.COLLABORATOR;