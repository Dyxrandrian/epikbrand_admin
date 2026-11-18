export interface RateLimitHit {
  /** Nombre de requêtes dans la fenêtre en cours, celle-ci comprise. */
  count: number;
  /** Fin de la fenêtre (ms depuis 1970). */
  resetAt: number;
}

/** Classe abstraite : sert aussi de jeton d'injection. Une version Redis la remplacera. */
export abstract class RateLimitStore {
  abstract hit(key: string, windowMs: number): Promise<RateLimitHit>;
}