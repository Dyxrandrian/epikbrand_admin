import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity.js';

export interface IdempotencyScope {
  companyId: string;
  userId: string;
}

export interface StoredKey {
  requestHash: string;
  status: string;
  responseBody: unknown;
}

@Injectable()
export class IdempotencyRepository {
  constructor(@InjectRepository(IdempotencyKey) private readonly repo: Repository<IdempotencyKey>) {}

  /** Supprime cette clé si elle a expiré (24 h) ou si sa requête a été abandonnée (plus de 5 min). */
  async purgeStale(scope: IdempotencyScope, key: string): Promise<void> {
    await this.repo.manager.query(
      `DELETE FROM idempotency_keys
        WHERE company_id = $1 AND user_id = $2 AND key = $3
          AND (expires_at < now()
               OR (status = 'in_progress' AND created_at < now() - interval '5 minutes'))`,
      [scope.companyId, scope.userId, key],
    );
  }

  /** Réserve la clé ; renvoie null si elle existe déjà. */
  async tryInsert(scope: IdempotencyScope, key: string, requestHash: string): Promise<string | null> {
    const rows: Array<{ id: string }> = await this.repo.manager.query(
      `INSERT INTO idempotency_keys (company_id, user_id, key, request_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '24 hours')
       ON CONFLICT (company_id, user_id, key) DO NOTHING
       RETURNING id`,
      [scope.companyId, scope.userId, key, requestHash],
    );
    return rows[0]?.id ?? null;
  }

  async find(scope: IdempotencyScope, key: string): Promise<StoredKey | null> {
    const rows: StoredKey[] = await this.repo.manager.query(
      `SELECT request_hash AS "requestHash", status, response_body AS "responseBody"
         FROM idempotency_keys
        WHERE company_id = $1 AND user_id = $2 AND key = $3`,
      [scope.companyId, scope.userId, key],
    );
    return rows[0] ?? null;
  }

  async complete(scope: IdempotencyScope, id: string, body: unknown): Promise<void> {
    await this.repo.manager.query(
      `UPDATE idempotency_keys
          SET status = 'completed', response_body = $4::jsonb
        WHERE id = $3 AND company_id = $1 AND user_id = $2`,
      [scope.companyId, scope.userId, id, body === undefined ? null : JSON.stringify(body)],
    );
  }

  async abandon(scope: IdempotencyScope, id: string): Promise<void> {
    await this.repo.manager.query(
      `DELETE FROM idempotency_keys
        WHERE id = $3 AND company_id = $1 AND user_id = $2 AND status = 'in_progress'`,
      [scope.companyId, scope.userId, id],
    );
  }
}