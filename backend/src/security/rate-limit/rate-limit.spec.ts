import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooManyRequestsException } from '../../exceptions/index.js';
import { InMemoryRateLimitStore } from './in-memory-rate-limit.store.js';
import { RateLimitService } from './rate-limit.service.js';

describe('Limitation de débit', () => {
  let store: InMemoryRateLimitStore;
  let service: RateLimitService;
  let headers: Record<string, string>;
  let response: Response;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    store = new InMemoryRateLimitStore();
    service = new RateLimitService(store);
    headers = {};
    response = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response;
  });

  afterEach(() => {
    store.onModuleDestroy();
    vi.useRealTimers();
  });

  const rule = { limit: 3, windowSeconds: 60 };

  it('laisse passer jusqu\'à la limite puis refuse avec Retry-After', async () => {
    for (let i = 0; i < 3; i++) await service.consume('cle', rule, response);

    const error = await service.consume('cle', rule, response).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TooManyRequestsException);
    expect((error as TooManyRequestsException).getStatus()).toBe(429);
    expect(headers['Retry-After']).toBe('60');
  });

  it('repart de zéro une fois la fenêtre écoulée', async () => {
    for (let i = 0; i < 3; i++) await service.consume('cle', rule, response);
    await expect(service.consume('cle', rule, response)).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );

    vi.advanceTimersByTime(61_000);

    await expect(service.consume('cle', rule, response)).resolves.toBeUndefined();
  });

  it('compte chaque clé séparément', async () => {
    for (let i = 0; i < 3; i++) await service.consume('ip:1.1.1.1', rule, response);

    await expect(service.consume('ip:2.2.2.2', rule, response)).resolves.toBeUndefined();
    await expect(service.consume('ip:1.1.1.1', rule, response)).rejects.toBeInstanceOf(
      TooManyRequestsException,
    );
  });

  it('Retry-After diminue avec le temps', async () => {
    for (let i = 0; i < 3; i++) await service.consume('cle', rule, response);
    vi.advanceTimersByTime(45_000);

    await service.consume('cle', rule, response).catch(() => undefined);

    expect(headers['Retry-After']).toBe('15');
  });
});