import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvalidTokenException } from '../../exceptions/index.js';

const LINK_TTL_MS = 5 * 60_000;
const MAX_TOKEN_LENGTH = 512;

export interface SharedLinkPayload {
  fileId: string;
  companyId: string;
  inline: boolean;
}

@Injectable()
export class FileLinkService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = createHmac('sha256', config.getOrThrow<string>('JWT_ACCESS_SECRET'))
      .update('epikbrand:file-links:v1')
      .digest();
  }

  sign(input: SharedLinkPayload): { token: string; expiresAt: Date } {
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    const payload = Buffer.from(
      JSON.stringify({
        f: input.fileId,
        c: input.companyId,
        e: Math.floor(expiresAt.getTime() / 1000),
        i: input.inline ? 1 : 0,
      }),
    ).toString('base64url');
    return { token: `${payload}.${this.signature(payload)}`, expiresAt };
  }

  verify(token: string): SharedLinkPayload {
    const invalid = (): InvalidTokenException =>
      new InvalidTokenException('Ce lien de téléchargement est invalide ou a expiré.');

    if (token.length > MAX_TOKEN_LENGTH) throw invalid();
    const parts = token.split('.');
    if (parts.length !== 2) throw invalid();
    const [payload, given] = parts;

    const expected = Buffer.from(this.signature(payload));
    const received = Buffer.from(given);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw invalid();

    let data: { f?: unknown; c?: unknown; e?: unknown; i?: unknown };
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw invalid();
    }
    if (
      typeof data.f !== 'string' ||
      typeof data.c !== 'string' ||
      typeof data.e !== 'number' ||
      data.e * 1000 <= Date.now()
    ) {
      throw invalid();
    }
    return { fileId: data.f, companyId: data.c, inline: data.i === 1 };
  }

  private signature(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}