import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { RefreshToken } from '../../entities/refresh-token.entity.js';
import { User } from '../../entities/user.entity.js';
import { ErrorCode, NotAuthenticatedException } from '../../exceptions/index.js';
import { AccessTokenService, generateOpaqueToken, hashToken } from '../../security/index.js';
import type { ClientMetadata } from '../../security/index.js';

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

@Injectable()
export class SessionService {
  private readonly refreshTtlMs: number;
  private readonly accessTtlSeconds: number;

  constructor(
    config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly accessTokens: AccessTokenService,
  ) {
    this.refreshTtlMs = Number(config.get('REFRESH_TOKEN_TTL_DAYS') ?? 30) * 86_400_000;
    this.accessTtlSeconds = Number(config.get('JWT_ACCESS_TTL_SECONDS') ?? 900);
  }

  /** Nouvelle connexion : nouvelle famille de jetons. */
  async open(user: User, meta: ClientMetadata): Promise<SessionTokens> {
    const raw = generateOpaqueToken();
    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        userAgent: meta.userAgent,
        ipAddress: meta.ip,
      }),
    );
    return this.buildTokens(user, raw);
  }

  /** Rotation à usage unique : l'ancien jeton est consommé, un nouveau le remplace. */
  async refresh(rawToken: string, meta: ClientMetadata): Promise<SessionTokens> {
    const record = await this.refreshTokens.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!record) throw this.invalidSession();

    // Jeton déjà utilisé ou révoqué : rejeu, on coupe toute la famille
    if (record.revokedAt) {
      await this.revokeFamily(record.familyId);
      throw this.invalidSession();
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new NotAuthenticatedException('Votre session a expiré.', ErrorCode.TOKEN_EXPIRED);
    }

    const user = await this.users.findOne({ where: { id: record.userId } });
    if (!user || !user.isActive || !user.isVerified) {
      await this.revokeFamily(record.familyId);
      throw this.invalidSession();
    }

    const raw = generateOpaqueToken();
    const rotated = await this.dataSource.transaction(async (manager) => {
      // "Réclamation" atomique : un seul appel simultané peut consommer ce jeton
      const claimed = await manager.update(
        RefreshToken,
        { id: record.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      if (!claimed.affected) return false;

      const next = await manager.save(
        manager.create(RefreshToken, {
          userId: user.id,
          familyId: record.familyId,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + this.refreshTtlMs),
          userAgent: meta.userAgent,
          ipAddress: meta.ip,
        }),
      );
      await manager.update(RefreshToken, { id: record.id }, { replacedById: next.id });
      return true;
    });

    if (!rotated) {
      await this.revokeFamily(record.familyId);
      throw this.invalidSession();
    }
    return this.buildTokens(user, raw);
  }

  /** Déconnexion d'une session (toute sa famille de jetons). */
  async logout(rawToken: string): Promise<void> {
    const record = await this.refreshTokens.findOne({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (record) await this.revokeFamily(record.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async buildTokens(user: User, refreshToken: string): Promise<SessionTokens> {
    return {
      access_token: await this.accessTokens.sign(user.id, user.companyId),
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.accessTtlSeconds,
    };
  }

  private invalidSession(): NotAuthenticatedException {
    return new NotAuthenticatedException('Session invalide, veuillez vous reconnecter.');
  }
}