import {
  BusinessRuleException,
  ErrorCode,
  ValidationFailedException,
} from '../../exceptions/index.js';

const MAX_CENTS = 999_999_999_999n; // limite de numeric(12,2)

const toCents = (value: number): bigint => BigInt(Math.round(value * 100));
const fromCents = (cents: bigint): number => Number(cents) / 100;
/** Division arrondie (moitié vers le haut) ; valeurs positives uniquement. */
const divRound = (n: bigint, d: bigint): bigint => (n + d / 2n) / d;

export const sameAmount = (a: number, b: number): boolean =>
  Math.round(a * 100) === Math.round(b * 100);

export const amountMismatch = (message: string, meta?: Record<string, unknown>) =>
  new BusinessRuleException(message, ErrorCode.AMOUNT_MISMATCH, meta);

const lineCents = (quantity: number, unitPrice: number): bigint =>
  divRound(toCents(quantity) * toCents(unitPrice), 100n);

/** Total d'une ligne : quantité × prix unitaire, arrondi au centime. */
export const lineTotal = (quantity: number, unitPrice: number): number =>
  fromCents(lineCents(quantity, unitPrice));

export function itemsTotal(
  items: ReadonlyArray<{ quantity: number; unitPrice: number }>,
): number {
  let total = 0n;
  for (const item of items) total += lineCents(item.quantity, item.unitPrice);
  if (total > MAX_CENTS) throw new BusinessRuleException('Le total des lignes est trop élevé.');
  return fromCents(total);
}

export interface AmountInput {
  ht: number;
  vatAmount?: number | null;
  vatRate?: number | null;
  ttc?: number | null;
}

export interface ResolvedAmounts {
  amountHt: number;
  vatAmount: number;
  amountTtc: number;
}

/**
 * HT + au choix (TVA en montant, TVA en taux, ou TTC) donnent les trois montants.
 * TVA en montant ET TTC : ils doivent être cohérents. Aucun des trois : TVA nulle.
 */
export function resolveAmounts(input: AmountInput): ResolvedAmounts {
  const ht = toCents(input.ht);
  const hasAmount = input.vatAmount != null;
  const hasRate = input.vatRate != null;
  const hasTtc = input.ttc != null;

  if (hasRate && (hasAmount || hasTtc)) {
    throw new ValidationFailedException([
      {
        field: 'vat_rate',
        reason: 'vatConflict',
        message: 'Indiquez soit vat_rate, soit vat_amount / amount_ttc, pas les deux.',
      },
    ]);
  }

  let vat: bigint;
  if (hasRate) {
    vat = divRound(ht * BigInt(Math.round((input.vatRate as number) * 10_000)), 10_000n);
  } else if (hasAmount) {
    vat = toCents(input.vatAmount as number);
    if (hasTtc && toCents(input.ttc as number) !== ht + vat) {
      throw amountMismatch('Le total TTC doit être égal au HT plus la TVA.', {
        amount_ht: input.ht,
        vat_amount: input.vatAmount,
        amount_ttc: input.ttc,
      });
    }
  } else if (hasTtc) {
    vat = toCents(input.ttc as number) - ht;
    if (vat < 0n) {
      throw amountMismatch('Le total TTC ne peut pas être inférieur au total HT.', {
        amount_ht: input.ht,
        amount_ttc: input.ttc,
      });
    }
  } else {
    vat = 0n;
  }

  const ttc = ht + vat;
  if (ttc > MAX_CENTS) throw new BusinessRuleException('Le montant TTC est trop élevé.');
  return { amountHt: fromCents(ht), vatAmount: fromCents(vat), amountTtc: fromCents(ttc) };
}