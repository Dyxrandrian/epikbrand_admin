import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

const OPTIONS = {
  type: argon2id,
  memoryCost: 19456, // ~19 Mo
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, OPTIONS);
  }

  /** Renvoie false (jamais d'exception) si le hash est absent ou malformé. */
  async verify(passwordHash: string | null, plain: string): Promise<boolean> {
    if (!passwordHash) return false;
    try {
      return await verify(passwordHash, plain);
    } catch {
      return false;
    }
  }

    /** Brûle le même temps de calcul qu'une vérification (anti-énumération). */
  async burn(plain: string): Promise<void> {
    await this.hash(plain);
  }
}