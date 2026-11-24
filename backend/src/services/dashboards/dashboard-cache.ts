import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface Stored {
  value: object;
  generatedAt: string;
}

/** Classe abstraite : sert aussi de jeton d'injection. Une version Redis la remplacera. */
export abstract class DashboardCacheStore {
  abstract get(key: string): Promise<Stored | undefined>;
  abstract set(key: string, entry: Stored, ttlMs: number): Promise<void>;
}

const MAX_ENTRIES = 500;

@Injectable()
export class InMemoryDashboardCacheStore extends DashboardCacheStore implements OnModuleDestroy {
  private readonly entries = new Map<string, { entry: Stored; expiresAt: number }>();
  private readonly cleaner: NodeJS.Timeout;

  constructor() {
    super();
    this.cleaner = setInterval(() => this.purge(), 60_000);
    this.cleaner.unref();
  }

  async get(key: string): Promise<Stored | undefined> {
    const found = this.entries.get(key);
    if (!found) return undefined;
    if (found.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return found.entry;
  }

  async set(key: string, entry: Stored, ttlMs: number): Promise<void> {
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(key)) {
      this.purge();
      // Toujours plein : on retire les plus anciennes (la Map garde l'ordre d'insertion)
      for (const oldest of this.entries.keys()) {
        if (this.entries.size < MAX_ENTRIES) break;
        this.entries.delete(oldest);
      }
    }
    this.entries.set(key, { entry, expiresAt: Date.now() + ttlMs });
  }

  onModuleDestroy(): void {
    clearInterval(this.cleaner);
    this.entries.clear();
  }

  private purge(): void {
    const now = Date.now();
    for (const [key, value] of this.entries) if (value.expiresAt <= now) this.entries.delete(key);
  }
}

export type Served<T> = { generated_at: string; cached: boolean; cache_ttl_seconds: number } & T;

@Injectable()
export class DashboardCacheService {
  private readonly logger = new Logger(DashboardCacheService.name);
  private readonly ttlSeconds: number;
  /** Calculs en cours : deux demandes identiques simultanées partagent un seul calcul. */
  private readonly inflight = new Map<string, Promise<Stored>>();

  constructor(
    config: ConfigService,
    private readonly store: DashboardCacheStore,
  ) {
    const raw = Number(config.get('DASHBOARD_CACHE_TTL_SECONDS') ?? 60);
    this.ttlSeconds = Number.isInteger(raw) && raw >= 0 ? raw : 60;
  }

  /** La clé inclut toujours l'entreprise, et le rôle ou l'utilisateur quand le contenu en dépend. */
  key(
    name: string,
    companyId: string,
    scope: string,
    parts: ReadonlyArray<string | number>,
  ): string {
    return `dash:${name}:${companyId}:${scope}:${parts.join('|')}`;
  }

  async serve<T extends object>(
    key: string,
    refresh: boolean,
    compute: () => Promise<T>,
  ): Promise<Served<T>> {
    if (!refresh && this.ttlSeconds > 0) {
      const hit = await this.store.get(key).catch(() => undefined);
      if (hit) return this.envelope<T>(hit, true);
    }

    let pending = refresh ? undefined : this.inflight.get(key);
    if (!pending) {
      const started = this.run(key, compute);
      pending = started;
      this.inflight.set(key, started);
      void started
        .finally(() => {
          if (this.inflight.get(key) === started) this.inflight.delete(key);
        })
        .catch(() => undefined);
    }
    return this.envelope<T>(await pending, false);
  }

  private async run<T extends object>(key: string, compute: () => Promise<T>): Promise<Stored> {
    const stored: Stored = { value: await compute(), generatedAt: new Date().toISOString() };
    if (this.ttlSeconds > 0) {
      await this.store.set(key, stored, this.ttlSeconds * 1000).catch((error: unknown) => {
        this.logger.warn(`Mise en cache impossible : ${(error as Error).message}`);
      });
    }
    return stored;
  }

  private envelope<T extends object>(stored: Stored, cached: boolean): Served<T> {
    return {
      generated_at: stored.generatedAt,
      cached,
      cache_ttl_seconds: this.ttlSeconds,
      ...(stored.value as T),
    };
  }
}