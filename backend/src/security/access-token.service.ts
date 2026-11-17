import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NotAuthenticatedException } from '../exceptions/app.exception.js';
import { ErrorCode } from '../exceptions/error-codes.js';
import type { AccessTokenPayload } from './authenticated-user.js';

@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(userId: string, companyId: string): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId, cid: companyId };
    return this.jwt.signAsync(payload);
  }

  async verify(token: string): Promise<AccessTokenPayload> {
    let payload: Partial<AccessTokenPayload>;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        algorithms: ['HS256'],
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new NotAuthenticatedException(
          'Votre session a expiré.',
          ErrorCode.TOKEN_EXPIRED,
        );
      }
      throw new NotAuthenticatedException('Jeton invalide.');
    }

    if (typeof payload.sub !== 'string' || typeof payload.cid !== 'string') {
      throw new NotAuthenticatedException('Jeton invalide.');
    }
    return { sub: payload.sub, cid: payload.cid };
  }
}