import type { InvoiceItemDto } from '../../dto/invoices/invoice-item.dto.js';
import type { Client } from '../../entities/client.entity.js';
import type { Company } from '../../entities/company.entity.js';
import type { ClientSnapshot, Invoice, SellerSnapshot } from '../../entities/invoice.entity.js';
import {
  DiscountType,
  InvoiceDocumentType,
  InvoicePaymentStatus,
} from '../../enums/app.enums.js';
import { BusinessRuleException, ValidationFailedException } from '../../exceptions/index.js';
import { computeDocument } from './invoice-calculator.js';
import type { DiscountInput, DocumentAmounts, LineInput } from './invoice-calculator.js';

export const DEFAULT_PREFIX: Record<InvoiceDocumentType, string> = {
  [InvoiceDocumentType.INVOICE]: 'FAC',
  [InvoiceDocumentType.QUOTE]: 'DEV',
  [InvoiceDocumentType.CREDIT_NOTE]: 'AVO',
};

export const cents = (value: number): number => Math.round(value * 100);
export const addMoney = (a: number, b: number): number => (cents(a) + cents(b)) / 100;

type Money = Pick<Invoice, 'totalTtc' | 'amountPaid' | 'creditedTotal'>;

/** Reste à payer : total moins paiements moins avoirs, jamais négatif. */
export const balanceDue = (invoice: Money): number =>
  Math.max(0, cents(invoice.totalTtc) - cents(invoice.amountPaid) - cents(invoice.creditedTotal)) / 100;

/** Trop-perçu à rembourser (facture payée puis créditée). */
export const refundDue = (invoice: Money): number =>
  Math.max(0, cents(invoice.amountPaid) + cents(invoice.creditedTotal) - cents(invoice.totalTtc)) / 100;

export function isOverdue(invoice: Invoice, today: string): boolean {
  return (
    invoice.type === InvoiceDocumentType.INVOICE &&
    (invoice.status === InvoicePaymentStatus.SENT ||
      invoice.status === InvoicePaymentStatus.OVERDUE) &&
    invoice.dueDate !== null &&
    invoice.dueDate < today &&
    balanceDue(invoice) > 0
  );
}

export function isExpiredQuote(invoice: Invoice, today: string): boolean {
  return (
    invoice.type === InvoiceDocumentType.QUOTE &&
    invoice.status === InvoicePaymentStatus.SENT &&
    invoice.validUntil !== null &&
    invoice.validUntil < today &&
    invoice.acceptedAt === null &&
    invoice.rejectedAt === null
  );
}

/** Statut d'une facture émise et non soldée selon son échéance. */
export const openStatus = (dueDate: string | null, today: string): InvoicePaymentStatus =>
  dueDate !== null && dueDate < today ? InvoicePaymentStatus.OVERDUE : InvoicePaymentStatus.SENT;

export const formatDocumentNumber = (prefix: string, year: number, sequence: number): string =>
  `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;

/** Une remise sans valeur est ignorée ; une valeur sans type est refusée. */
export function normalizeDiscount(
  type: DiscountType | null | undefined,
  value: number | null | undefined,
  fieldPrefix: string,
): DiscountInput {
  const amount = value ?? 0;
  if (!type) {
    if (amount > 0) {
      throw new ValidationFailedException([
        {
          field: `${fieldPrefix}discount_type`,
          reason: 'discountTypeRequired',
          message: 'Précisez le type de remise (percent ou amount).',
        },
      ]);
    }
    return { type: null, value: 0 };
  }
  if (!(amount > 0)) return { type: null, value: 0 };
  if (type === DiscountType.PERCENT && amount > 100) {
    throw new ValidationFailedException([
      {
        field: `${fieldPrefix}discount_value`,
        reason: 'discountPercentTooHigh',
        message: 'Une remise en pourcentage ne peut pas dépasser 100.',
      },
    ]);
  }
  return { type, value: amount };
}

export interface ItemRow {
  position: number;
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number;
  discountType: DiscountType | null;
  discountValue: number;
  discountAmount: number;
  totalHt: number;
}

export function prepareItems(
  items: readonly InvoiceItemDto[],
  defaultVatRate: number,
  discount: DiscountInput,
): { rows: ItemRow[]; amounts: DocumentAmounts } {
  const lines: LineInput[] = items.map((item, index) => {
    const lineDiscount = normalizeDiscount(item.discount_type, item.discount_value, `items.${index}.`);
    return {
      quantity: item.quantity,
      unitPrice: item.unit_price,
      vatRate: item.vat_rate ?? defaultVatRate,
      discountType: lineDiscount.type,
      discountValue: lineDiscount.value,
    };
  });

  const amounts = computeDocument(lines, discount);
  const rows = items.map((item, index) => ({
    position: index,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit ?? null,
    unitPrice: item.unit_price,
    vatRate: lines[index].vatRate,
    discountType: lines[index].discountType,
    discountValue: lines[index].discountValue,
    discountAmount: amounts.lines[index].discountAmount,
    totalHt: amounts.lines[index].totalHt,
  }));
  return { rows, amounts };
}

/** Colonnes de totaux du document à partir du résultat du calcul. */
export const totalsColumns = (amounts: DocumentAmounts) => ({
  subtotalHt: amounts.subtotalHt,
  discountAmount: amounts.discountAmount,
  totalHt: amounts.totalHt,
  totalVat: amounts.totalVat,
  totalTtc: amounts.totalTtc,
});

export function assertDates(
  type: InvoiceDocumentType,
  issueDate: string,
  dueDate: string | null,
  validUntil: string | null,
): void {
  if (type === InvoiceDocumentType.QUOTE && dueDate !== null) {
    throw new BusinessRuleException("Un devis n'a pas d'échéance de paiement : utilisez valid_until.");
  }
  if (type !== InvoiceDocumentType.QUOTE && validUntil !== null) {
    throw new BusinessRuleException('valid_until ne concerne que les devis.');
  }
  if (dueDate !== null && dueDate < issueDate) {
    throw new BusinessRuleException("L'échéance ne peut pas précéder la date d'émission.");
  }
  if (validUntil !== null && validUntil < issueDate) {
    throw new BusinessRuleException("La fin de validité ne peut pas précéder la date d'émission.");
  }
}

export const buildClientSnapshot = (client: Client): ClientSnapshot => ({
  company_name: client.companyName,
  contact_name: client.contactName,
  email: client.email,
  phone: client.phone,
  address: client.address,
  nif: client.nif,
  stat: client.stat,
});

export const buildSellerSnapshot = (company: Company): SellerSnapshot => ({
  name: company.name,
  address: company.address,
  phone: company.phone,
  website_url: company.websiteUrl,
  tax_info: company.taxInfo,
  nif: company.nif,
  stat: company.stat,
  rcs: company.rcs,
  bank_name: company.bankName,
  bank_account_holder: company.bankAccountHolder,
  bank_account_number: company.bankAccountNumber,
  bank_swift: company.bankSwift,
  mobile_money_details: company.mobileMoneyDetails,
  invoice_footer: company.invoiceFooter,
});