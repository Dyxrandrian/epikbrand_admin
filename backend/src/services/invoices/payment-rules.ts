import type { Invoice } from '../../entities/invoice.entity.js';
import { InvoicePaymentStatus } from '../../enums/app.enums.js';
import type { PaymentMethod } from '../../enums/app.enums.js';
import { balanceDue, openStatus } from './invoice-rules.js';

export interface LatestPayment {
  paidAt: string;
  method: PaymentMethod;
}

export interface Settlement {
  status: InvoicePaymentStatus;
  paidAt: string | null;
  paymentMethod: PaymentMethod | null;
}

/**
 * Situation d'une facture émise, à partir de la somme des paiements et du total des avoirs.
 * - Solde positif : « envoyée » ou « en retard » selon l'échéance, sans date de règlement.
 * - Solde nul : « payée », avec la date et le moyen du dernier paiement. Soldée par avoirs
 *   seuls, elle garde sa date de règlement existante et n'a pas de moyen de paiement.
 */
export function settle(
  invoice: Pick<Invoice, 'totalTtc' | 'creditedTotal' | 'dueDate' | 'paidAt'>,
  amountPaid: number,
  latest: LatestPayment | null,
  today: string,
): Settlement {
  const balance = balanceDue({
    totalTtc: invoice.totalTtc,
    amountPaid,
    creditedTotal: invoice.creditedTotal,
  });

  if (balance > 0) {
    return { status: openStatus(invoice.dueDate, today), paidAt: null, paymentMethod: null };
  }
  return {
    status: InvoicePaymentStatus.PAID,
    paidAt: latest?.paidAt ?? invoice.paidAt ?? today,
    paymentMethod: latest?.method ?? null,
  };
}