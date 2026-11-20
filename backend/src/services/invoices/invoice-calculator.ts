import { DiscountType } from '../../enums/app.enums.js';
import { BusinessRuleException } from '../../exceptions/index.js';

export interface DiscountInput {
  type: DiscountType | null;
  value: number;
}

export interface LineInput {
  quantity: number;
  unitPrice: number;
  vatRate: number;
  discountType: DiscountType | null;
  discountValue: number;
}

export interface LineAmounts {
  grossHt: number;
  discountAmount: number;
  totalHt: number;
}

export interface VatGroup {
  rate: number;
  baseHt: number;
  vat: number;
}

export interface DocumentAmounts {
  lines: LineAmounts[];
  subtotalHt: number;
  discountAmount: number;
  totalHt: number;
  vatBreakdown: VatGroup[];
  totalVat: number;
  totalTtc: number;
}

/** Limite de numeric(14,2). */
export const MAX_AMOUNT = 999_999_999_999.99;

const toCents = (value: number): bigint => BigInt(Math.round(value * 100));
const fromCents = (cents: bigint): number => Number(cents) / 100;
const toBasisPoints = (rate: number): bigint => BigInt(Math.round(rate * 10_000));

/** Division arrondie (moitié vers le haut) ; valeurs positives uniquement. */
const divRound = (n: bigint, d: bigint): bigint => (n + d / 2n) / d;

/** Répartit `total` au prorata de `weights`, la somme des parts valant exactement `total`. */
function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0n);
  if (total === 0n || sum === 0n) return weights.map(() => 0n);

  const shares = weights.map((weight) => (total * weight) / sum);
  let left = total - shares.reduce((acc, share) => acc + share, 0n);

  const byRemainder = weights
    .map((weight, index) => ({ index, remainder: (total * weight) % sum }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  for (const { index } of byRemainder) {
    if (left <= 0n) break;
    shares[index] += 1n;
    left -= 1n;
  }
  return shares;
}

export function computeDocument(
  lines: readonly LineInput[],
  discount: DiscountInput,
): DocumentAmounts {
  const max = toCents(MAX_AMOUNT);

  const raw = lines.map((line, index) => {
    const gross = divRound(toCents(line.quantity) * toCents(line.unitPrice), 100n);
    if (gross > max) {
      throw new BusinessRuleException(`Le montant de la ligne ${index + 1} est trop élevé.`);
    }

    let lineDiscount = 0n;
    if (line.discountType === DiscountType.PERCENT) {
      lineDiscount = divRound(gross * toCents(line.discountValue), 10_000n);
    } else if (line.discountType === DiscountType.AMOUNT) {
      lineDiscount = toCents(line.discountValue);
      if (lineDiscount > gross) {
        throw new BusinessRuleException(
          `La remise de la ligne ${index + 1} dépasse le montant de la ligne.`,
        );
      }
    }
    return {
      gross,
      discount: lineDiscount,
      total: gross - lineDiscount,
      rate: toBasisPoints(line.vatRate),
    };
  });

  const subtotal = raw.reduce((sum, line) => sum + line.total, 0n);

  let documentDiscount = 0n;
  if (discount.type === DiscountType.PERCENT) {
    documentDiscount = divRound(subtotal * toCents(discount.value), 10_000n);
  } else if (discount.type === DiscountType.AMOUNT) {
    documentDiscount = toCents(discount.value);
    if (documentDiscount > subtotal) {
      throw new BusinessRuleException('La remise globale dépasse le total du document.');
    }
  }

  // TVA par taux, sur la base après remise globale
  const byRate = new Map<bigint, bigint>();
  for (const line of raw) byRate.set(line.rate, (byRate.get(line.rate) ?? 0n) + line.total);
  const groups = [...byRate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const shares = allocate(
    documentDiscount,
    groups.map(([, total]) => total),
  );

  const breakdown = groups
    .map(([rate, total], index) => {
      const base = total - shares[index];
      return { rate, base, vat: divRound(base * rate, 10_000n) };
    })
    .filter((group) => group.base > 0n);

  const totalVat = breakdown.reduce((sum, group) => sum + group.vat, 0n);
  const totalHt = subtotal - documentDiscount;
  const totalTtc = totalHt + totalVat;
  if (totalTtc > max) throw new BusinessRuleException('Le total du document est trop élevé.');

  return {
    lines: raw.map((line) => ({
      grossHt: fromCents(line.gross),
      discountAmount: fromCents(line.discount),
      totalHt: fromCents(line.total),
    })),
    subtotalHt: fromCents(subtotal),
    discountAmount: fromCents(documentDiscount),
    totalHt: fromCents(totalHt),
    vatBreakdown: breakdown.map((group) => ({
      rate: Number(group.rate) / 10_000,
      baseHt: fromCents(group.base),
      vat: fromCents(group.vat),
    })),
    totalVat: fromCents(totalVat),
    totalTtc: fromCents(totalTtc),
  };
}

/** Ligne stockée vers entrée de calcul (recalcul à l'identique pour l'affichage). */
export function lineInputOf(item: {
  quantity: number;
  unitPrice: number;
  vatRate: number;
  discountType: DiscountType | null;
  discountValue: number;
}): LineInput {
  return {
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    vatRate: item.vatRate,
    discountType: item.discountType,
    discountValue: item.discountValue,
  };
}