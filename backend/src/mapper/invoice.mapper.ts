import type { InvoiceItem } from '../entities/invoice-item.entity.js';
import type { ClientSnapshot, Invoice, SellerSnapshot } from '../entities/invoice.entity.js';
import { computeDocument, lineInputOf } from '../services/invoices/invoice-calculator.js';
import {
  balanceDue,
  isExpiredQuote,
  isOverdue,
  refundDue,
} from '../services/invoices/invoice-rules.js';
import type { InvoicePayment } from '../entities/invoice-payment.entity.js';

export function toInvoiceItem(item: InvoiceItem) {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unitPrice,
    vat_rate: item.vatRate,
    discount_type: item.discountType,
    discount_value: item.discountValue,
    discount_amount: item.discountAmount,
    total_ht: item.totalHt,
  };
}

/** `client` et `project` n'apparaissent que si la relation a été chargée. */
export function toInvoice(invoice: Invoice, today: string) {
  return {
    id: invoice.id,
    type: invoice.type,
    status: invoice.status,
    invoice_number: invoice.invoiceNumber, // null tant que c'est un brouillon
    client_id: invoice.clientId,
    project_id: invoice.projectId,
    source_document_id: invoice.sourceDocumentId,
    issue_date: invoice.issueDate,
    due_date: invoice.dueDate,
    valid_until: invoice.validUntil,
    currency: invoice.currency,
    vat_rate: invoice.vatRate,
    discount_type: invoice.discountType,
    discount_value: invoice.discountValue,
    discount_amount: invoice.discountAmount,
    subtotal_ht: invoice.subtotalHt,
    total_ht: invoice.totalHt,
    total_vat: invoice.totalVat,
    total_ttc: invoice.totalTtc,
    amount_paid: invoice.amountPaid,
    credited_total: invoice.creditedTotal,
    balance_due: balanceDue(invoice),
    refund_due: refundDue(invoice),
    is_overdue: isOverdue(invoice, today),
    is_expired: isExpiredQuote(invoice, today),
    accepted_at: invoice.acceptedAt,
    rejected_at: invoice.rejectedAt,
    sent_at: invoice.sentAt,
    paid_at: invoice.paidAt,
    payment_method: invoice.paymentMethod,
    notes: invoice.notes,
    payment_terms: invoice.paymentTerms,
    footer: invoice.footer,
    ...(invoice.client
      ? { client: { id: invoice.client.id, company_name: invoice.client.companyName } }
      : {}),
    ...(invoice.project
      ? { project: { id: invoice.project.id, title: invoice.project.title } }
      : {}),
    version: invoice.version, // à renvoyer lors d'une modification
    created_at: invoice.createdAt,
    updated_at: invoice.updatedAt,
  };
}

export interface InvoiceDetailContext {
  today: string;
  items: InvoiceItem[];
  /** Figés à l'émission ; avant, les données actuelles. */
  seller: SellerSnapshot;
  client: ClientSnapshot;
  source: Invoice | null;
}

export function toInvoiceDetail(invoice: Invoice, ctx: InvoiceDetailContext) {
  const amounts = computeDocument(ctx.items.map(lineInputOf), {
    type: invoice.discountType,
    value: invoice.discountValue,
  });

  return {
    ...toInvoice(invoice, ctx.today),
    items: ctx.items.map(toInvoiceItem),
    vat_breakdown: amounts.vatBreakdown.map((group) => ({
      rate: group.rate,
      base_ht: group.baseHt,
      vat: group.vat,
    })),
    seller: ctx.seller,
    client_details: ctx.client,
    source: ctx.source
      ? { id: ctx.source.id, type: ctx.source.type, invoice_number: ctx.source.invoiceNumber }
      : null,
  };
}

/** `creator` n'apparaît que si la relation a été chargée (null si l'auteur a été supprimé). */
export function toInvoicePayment(payment: InvoicePayment) {
  return {
    id: payment.id,
    invoice_id: payment.invoiceId,
    amount: payment.amount,
    paid_at: payment.paidAt,
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    created_by: payment.createdById,
    ...(payment.createdBy !== undefined
      ? {
          creator: payment.createdBy
            ? { id: payment.createdBy.id, name: payment.createdBy.name }
            : null,
        }
      : {}),
    created_at: payment.createdAt,
  };
}

export function toLinkedDocument(doc: Invoice) {
  return {
    id: doc.id,
    type: doc.type,
    status: doc.status,
    invoice_number: doc.invoiceNumber,
    issue_date: doc.issueDate,
    total_ttc: doc.totalTtc,
    currency: doc.currency,
  };
}

export type InvoiceDetail = ReturnType<typeof toInvoiceDetail>;