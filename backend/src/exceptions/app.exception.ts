import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.js';

export interface ErrorDetail {
  field: string;
  reason: string;
  message: string;
}

export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    public readonly details?: ErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }
}

/** 400 : champs invalides (liste des champs en cause). */
export class ValidationFailedException extends AppException {
  constructor(details: ErrorDetail[]) {
    super(
      ErrorCode.VALIDATION_FAILED,
      'Les données envoyées sont invalides.',
      HttpStatus.BAD_REQUEST,
      details,
    );
  }
}

/** 401 : non authentifié (jeton absent, expiré, identifiants faux…). */
export class NotAuthenticatedException extends AppException {
  constructor(
    message = 'Authentification requise.',
    code: ErrorCode = ErrorCode.UNAUTHENTICATED,
  ) {
    super(code, message, HttpStatus.UNAUTHORIZED);
  }
}

/** 403 : authentifié mais droits insuffisants. */
export class AccessDeniedException extends AppException {
  constructor(
    message = "Vous n'avez pas les droits nécessaires pour cette action.",
    code: ErrorCode = ErrorCode.FORBIDDEN,
  ) {
    super(code, message, HttpStatus.FORBIDDEN);
  }
}

/** 404 : introuvable, y compris si la ressource appartient à une autre entreprise. */
export class ResourceNotFoundException extends AppException {
  constructor(resource = 'Ressource') {
    super(ErrorCode.NOT_FOUND, `${resource} introuvable.`, HttpStatus.NOT_FOUND);
  }
}

/** 409 : doublon, version périmée, état incompatible, objet encore lié. */
export class ConflictAppException extends AppException {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.CONFLICT,
  ) {
    super(code, message, HttpStatus.CONFLICT);
  }
}

/** 422 : règle métier violée. */
export class BusinessRuleException extends AppException {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.BUSINESS_RULE_VIOLATION,
  ) {
    super(code, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** 400 : jeton à usage unique (e-mail, mot de passe, invitation) invalide, expiré ou déjà utilisé. */
export class InvalidTokenException extends AppException {
  constructor(message = 'Ce lien est invalide ou a expiré.') {
    super(ErrorCode.INVALID_TOKEN, message, HttpStatus.BAD_REQUEST);
  }
}

/** 429 : compte verrouillé temporairement après trop d'échecs de connexion. */
export class AccountLockedException extends AppException {
  constructor(minutes: number) {
    super(
      ErrorCode.ACCOUNT_LOCKED,
      `Compte temporairement verrouillé après trop de tentatives. Réessayez dans ${minutes} minute(s).`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** 422 : un identifiant du corps de la requête ne correspond à rien dans l'entreprise. */
export class InvalidReferenceException extends AppException {
  constructor(field: string, resource: string) {
    super(
      ErrorCode.INVALID_REFERENCE,
      'Une référence est invalide.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        {
          field,
          reason: 'referenceNotFound',
          message: `${resource} introuvable.`,
        },
      ],
    );
  }
}