import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { AppException } from './app.exception.js';
import type { ErrorDetail } from './app.exception.js';
import { ErrorCode } from './error-codes.js';

interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  meta?: Record<string, unknown>;
}

const DEFAULTS: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: ErrorCode.BAD_REQUEST, message: 'Requête mal formée.' },
  401: { code: ErrorCode.UNAUTHENTICATED, message: 'Authentification requise.' },
  403: {
    code: ErrorCode.FORBIDDEN,
    message: "Vous n'avez pas les droits nécessaires pour cette action.",
  },
  404: { code: ErrorCode.NOT_FOUND, message: 'Ressource introuvable.' },
  409: {
    code: ErrorCode.CONFLICT,
    message: "Conflit avec l'état actuel de la ressource.",
  },
  413: {
    code: ErrorCode.FILE_TOO_LARGE,
    message: 'Le fichier est trop volumineux (25 Mo maximum).',
  },
  422: {
    code: ErrorCode.BUSINESS_RULE_VIOLATION,
    message: 'Cette opération viole une règle métier.',
  },
  429: {
    code: ErrorCode.TOO_MANY_REQUESTS,
    message: 'Trop de requêtes, réessayez dans un instant.',
  },
};

const INTERNAL: NormalizedError = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: ErrorCode.INTERNAL_ERROR,
  message: 'Une erreur interne est survenue.',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const error = this.normalize(exception);

    if (error.status >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${request.method} ${request.originalUrl}`, stack);
    }

    response.status(error.status).json({
      statusCode: error.status,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        ...(error.meta ? { meta: error.meta } : {}),
      },
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }

  private normalize(exception: unknown): NormalizedError {
    // 1. Nos exceptions métier : tout est déjà défini
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        meta: exception.meta,
      };
    }

    // 2. Autres erreurs HTTP de Nest (route inconnue, JSON invalide, 429…)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const fallback = DEFAULTS[status];
      if (fallback) return { status, ...fallback };
      return { ...INTERNAL, status };
    }

    // 3. Erreurs PostgreSQL : dernier filet de sécurité
    if (exception instanceof QueryFailedError) {
      return this.fromDatabase(exception);
    }

    // 4. Tout le reste : bug. On ne révèle rien au client.
    return INTERNAL;
  }

  private fromDatabase(exception: QueryFailedError): NormalizedError {
    const driver = exception.driverError as { code?: string; constraint?: string };

    switch (driver?.code) {
      case '23505': // violation d'unicité
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.DUPLICATE_RESOURCE,
          message: 'Une ressource identique existe déjà.',
        };
      case '23503': // clé étrangère (ex. suppression RESTRICT)
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.REFERENCE_CONFLICT,
          message: 'Opération impossible : cette ressource est liée à d\'autres données.',
        };
      case '23514': // contrainte CHECK
        this.logger.warn(`Contrainte CHECK violée : ${driver.constraint ?? 'inconnue'}`);
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: ErrorCode.BUSINESS_RULE_VIOLATION,
          message: 'Les données envoyées violent une règle d\'intégrité.',
        };
      case '22P02': // texte invalide pour le type (ex. UUID mal formé)
      case '22007': // date invalide
      case '22008':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ErrorCode.BAD_REQUEST,
          message: 'Requête mal formée.',
        };
      default:
        return INTERNAL;
    }
  }
}