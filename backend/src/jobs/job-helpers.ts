import type { Logger } from '@nestjs/common';
import type { FileStorage } from '../services/files/storage/file-storage.js';
import { formatMoney, moneyDecimals } from '../services/invoices/pdf/pdf-format.js';
import { currencySymbol } from '../services/invoices/pdf/pdf-theme.js';

/** Au-delà, les notifications individuelles laissent place à un résumé. */
export const MAX_INDIVIDUAL_NOTIFICATIONS = 10;

export async function notifyUpTo<T>(
  items: readonly T[],
  limit: number,
  one: (item: T) => Promise<void>,
  rest: (remaining: number) => Promise<void>,
): Promise<void> {
  for (const item of items.slice(0, limit)) await one(item);
  if (items.length > limit) await rest(items.length - limit);
}

/** Supprime des objets du stockage, sans jamais faire échouer la tâche si l'un d'eux résiste. */
export async function deleteStorageObjects(
  storage: FileStorage,
  keys: readonly string[],
  logger: Logger,
): Promise<void> {
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (error) {
      logger.error(`Suppression de l'objet de stockage impossible : ${key}`, error as Error);
    }
  }
}

export const daysAgo = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 86_400_000);

export const maxDate = (a: string, b: string): string => (a > b ? a : b);

/** « 12 500 Ar », « 1 200,50 € » : montant lisible dans une notification. */
export function moneyText(amount: number | string, currency: string): string {
  const value = Number(amount);
  return `${formatMoney(value, moneyDecimals([value]))} ${currencySymbol(currency.trim())}`;
}

export const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2000);