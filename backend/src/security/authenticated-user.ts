import type { Request } from 'express';
import type { UserRole } from '../enums/app.enums.js';

export interface AuthenticatedUser {
  id: string;
  companyId: string;
  role: UserRole;
  name: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/** Contenu du jeton d'accès : uniquement l'utilisateur et l'entreprise. */
export interface AccessTokenPayload {
  sub: string;
  cid: string;
}