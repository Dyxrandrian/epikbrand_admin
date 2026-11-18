import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { RateLimitStore } from './rate-limit.store.js';
import type { RateLimitHit } from './rate-limit.store.js';

@Injectable()
export class InMemoryRateLimitStore extends RateLimitStore implements OnModuleDestroy {
  private readonly buckets = new Map<string, RateLimitHit>();
  private readonly cleaner: NodeJS.Timeout;

  constructor() {
    super();
    // Nettoyage des fenêtres expirées ; unref : ne retient pas l'arrêt du processus
    this.cleaner = setInterval(() => this.purge(), 60_000);
    this.cleaner.unref();
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    const current = this.buckets.get(key);

    if (!current || current.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return { ...fresh };
    }

    current.count += 1;
    return { ...current };
  }

  onModuleDestroy(): void {
    clearInterval(this.cleaner);
    this.buckets.clear();
  }

  private purge(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}