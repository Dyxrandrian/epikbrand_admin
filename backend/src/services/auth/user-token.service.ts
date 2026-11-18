import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { UserToken } from '../../entities/user-token.entity.js';
import type { UserTokenPurpose } from '../../enums/app.enums.js';
import { InvalidTokenException } from '../../exceptions/index.js';
import { generateOpaqueToken, hashToken } from '../../security/index.js';

@Injectable()
export class UserTokenService {
  constructor(
    @InjectRepository(UserToken) private readonly tokens: Repository<UserToken>,
  ) {}

  /** Vrai si un jeton de ce type a déjà été émis il y a moins de `seconds` secondes. */
  async wasIssuedRecently(
    userId: string,
    purpose: UserTokenPurpose,
    seconds: number,
  ): Promise<boolean> {
    const last = await this.tokens.findOne({
      where: { userId, purpose },
      order: { createdAt: 'DESC' },
      select: { id: true, createdAt: true },
    });
    return !!last && Date.now() - last.createdAt.getTime() < seconds * 1000;
  }

  /** Émet un jeton (renvoyé en clair, une seule fois) et invalide les précédents. */
  async issue(
    manager: EntityManager,
    userId: string,
    purpose: UserTokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    await this.invalidateAll(manager, userId, purpose);

    const raw = generateOpaqueToken();
    await manager.save(
      manager.create(UserToken, {
        userId,
        purpose,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + ttlMs),
      }),
    );
    return raw;
  }

  /** Marque comme utilisés tous les jetons encore valides de ce type. */
  async invalidateAll(
    manager: EntityManager,
    userId: string,
    purpose: UserTokenPurpose,
  ): Promise<void> {
    await manager.update(
      UserToken,
      { userId, purpose, usedAt: IsNull() },
      { usedAt: new Date() },
    );
  }

  /** Vérifie et consomme un jeton de façon atomique, sinon lève INVALID_TOKEN. */
  async consume(
    manager: EntityManager,
    rawToken: string,
    purpose: UserTokenPurpose,
  ): Promise<UserToken> {
    const record = await manager.findOne(UserToken, {
      where: { tokenHash: hashToken(rawToken), purpose },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new InvalidTokenException();
    }

    // Deux requêtes simultanées ne peuvent pas consommer le même jeton
    const claimed = await manager.update(
      UserToken,
      { id: record.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (!claimed.affected) throw new InvalidTokenException();

    return record;
  }
}