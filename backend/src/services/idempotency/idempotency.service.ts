import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
  ValidationFailedException,
} from '../../exceptions/index.js';
import { IdempotencyRepository } from '../../repository/idempotency.repository.js';
import type { IdempotencyScope } from '../../repository/idempotency.repository.js';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
const MAX_ATTEMPTS = 3;

export type BeginResult =
  | { kind: 'started'; id: string }
  | { kind: 'replay'; body: unknown };

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly repo: IdempotencyRepository) {}

  parseKey(raw: string | string[]): string {
    const value = Array.isArray(raw) ? raw.join(',') : raw;
    if (!KEY_PATTERN.test(value)) {
      throw new ValidationFailedException([
        {
          field: 'Idempotency-Key',
          reason: 'invalidIdempotencyKey',
          message:
            "L'en-tête Idempotency-Key doit contenir 8 à 128 caractères (lettres, chiffres, - _ . :), par exemple un UUID.",
        },
      ]);
    }
    return value;
  }

  hashRequest(method: string, url: string, body: unknown): string {
    return createHash('sha256')
      .update(`${method}\n${url}\n${JSON.stringify(body ?? {})}`)
      .digest('hex');
  }

  async begin(scope: IdempotencyScope, key: string, requestHash: string): Promise<BeginResult> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this.repo.purgeStale(scope, key);

      const id = await this.repo.tryInsert(scope, key, requestHash);
      if (id) return { kind: 'started', id };

      const existing = await this.repo.find(scope, key);
      if (!existing) continue; // supprimée entre-temps : on réessaie

      if (existing.requestHash !== requestHash) {
        throw new BusinessRuleException(
          "Cette clé d'idempotence a déjà été utilisée pour une autre requête.",
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
        );
      }
      if (existing.status === 'completed') {
        return { kind: 'replay', body: existing.responseBody ?? undefined };
      }
      break;
    }
    throw new ConflictAppException(
      'Une requête identique est en cours de traitement. Réessayez dans un instant.',
      ErrorCode.REQUEST_IN_PROGRESS,
    );
  }

  /** Ne lève jamais d'erreur : la réponse est déjà prête, on ne la fait pas échouer pour si peu. */
  async complete(scope: IdempotencyScope, id: string, value: unknown): Promise<void> {
    try {
      // Même sérialisation que la réponse réelle : dates en texte ISO, etc.
      const body = value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
      await this.repo.complete(scope, id, body);
    } catch (error) {
      this.logger.error("Mémorisation de la réponse d'idempotence impossible", error as Error);
    }
  }

  async abandon(scope: IdempotencyScope, id: string): Promise<void> {
    try {
      await this.repo.abandon(scope, id);
    } catch (error) {
      this.logger.error("Libération de la clé d'idempotence impossible", error as Error);
    }
  }
}