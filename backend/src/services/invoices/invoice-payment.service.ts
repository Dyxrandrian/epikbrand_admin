import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { CreatePaymentDto, MarkPaidDto } from '../../dto/invoices/index.js';
import type { Invoice } from '../../entities/invoice.entity.js';
import { InvoiceDocumentType, InvoicePaymentStatus } from '../../enums/app.enums.js';
import type { PaymentMethod } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
} from '../../exceptions/index.js';
import { toInvoicePayment } from '../../mapper/invoice.mapper.js';
import { InvoicePaymentRepository } from '../../repository/invoice-payment.repository.js';
import { InvoiceRepository } from '../../repository/invoice.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { INVOICE_AUDIT_FIELDS, INVOICE_PAYMENT_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { InvoiceService } from './invoice.service.js';
import { balanceDue, cents } from './invoice-rules.js';
import { settle } from './payment-rules.js';

interface PaymentInput {
  /** null = le restant dû (action « marquer comme payée »). */
  amount: number | null;
  paidAt?: string;
  method: PaymentMethod;
  reference?: string | null;
  notes?: string | null;
}

@Injectable()
export class InvoicePaymentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly invoices: InvoiceRepository,
    private readonly payments: InvoicePaymentRepository,
    private readonly invoiceService: InvoiceService,
    private readonly audit: AuditService,
  ) {}

  async list(viewer: AuthenticatedUser, invoiceId: string) {
    await this.invoices.getById(viewer.companyId, invoiceId); // 404 si étrangère
    const items = await this.payments.listForInvoice(viewer.companyId, invoiceId);
    return items.map(toInvoicePayment);
  }

  record(user: AuthenticatedUser, invoiceId: string, dto: CreatePaymentDto) {
    return this.recordPayment(user, invoiceId, {
      amount: dto.amount,
      paidAt: dto.paid_at,
      method: dto.method,
      reference: dto.reference,
      notes: dto.notes,
    });
  }

  markPaid(user: AuthenticatedUser, invoiceId: string, dto: MarkPaidDto) {
    return this.recordPayment(user, invoiceId, {
      amount: null,
      paidAt: dto.paid_at,
      method: dto.method,
      reference: dto.reference,
      notes: dto.notes,
    });
  }

  /** Suppression (admin) : la facture retrouve la situation que donnent les paiements restants. */
  async remove(admin: AuthenticatedUser, invoiceId: string, paymentId: string): Promise<void> {
    const { companyId } = admin;
    const { today } = await this.invoiceService.context(companyId);

    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoices.withManager(manager).lockById(companyId, invoiceId);
      const payments = this.payments.withManager(manager);
      const payment = await payments.getForInvoice(companyId, invoiceId, paymentId); // 404

      if (invoice.status === InvoicePaymentStatus.CANCELLED) {
        throw new ConflictAppException('Cette facture est annulée.', ErrorCode.INVALID_STATE);
      }

      const before = snapshot(payment, INVOICE_PAYMENT_AUDIT_FIELDS);
      await payments.deleteById(companyId, paymentId);

      await this.audit.record(
        {
          action: AuditAction.PAYMENT_DELETED,
          entityType: AuditEntityType.INVOICE_PAYMENT,
          entityId: paymentId,
          companyId,
          userId: admin.id,
          changes: { before },
        },
        manager,
      );
      await this.syncInvoice(manager, admin, invoice, today);
    });
  }

  // ---------- Outils internes ----------

  private async recordPayment(user: AuthenticatedUser, invoiceId: string, input: PaymentInput) {
    const { companyId } = user;
    const { today } = await this.invoiceService.context(companyId);

    const paymentId = await this.dataSource.transaction(async (manager) => {
      // Verrou de ligne : deux paiements simultanés ne peuvent pas dépasser le restant dû
      const invoice = await this.invoices.withManager(manager).lockById(companyId, invoiceId);
      this.assertAcceptsPayments(invoice);

      const balance = balanceDue(invoice);
      const amount = input.amount ?? balance;
      if (cents(amount) <= 0) {
        throw new ConflictAppException('Cette facture est déjà soldée.', ErrorCode.INVALID_STATE);
      }
      if (cents(amount) > cents(balance)) {
        throw new BusinessRuleException(
          `Le paiement (${amount}) dépasse le restant dû (${balance}).`,
          ErrorCode.PAYMENT_EXCEEDS_BALANCE,
          { balance_due: balance },
        );
      }

      const paidAt = input.paidAt ?? today;
      if (paidAt > today) {
        throw new BusinessRuleException('La date du paiement ne peut pas être dans le futur.');
      }
      if (paidAt < invoice.issueDate) {
        throw new BusinessRuleException(
          "La date du paiement ne peut pas précéder la date d'émission de la facture.",
        );
      }

      const created = await this.payments.withManager(manager).insertPayment(companyId, {
        invoiceId,
        amount,
        paidAt,
        method: input.method,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        createdById: user.id,
      });

      await this.audit.record(
        {
          action: AuditAction.PAYMENT_RECORDED,
          entityType: AuditEntityType.INVOICE_PAYMENT,
          entityId: created.id,
          companyId,
          userId: user.id,
          changes: { after: snapshot(created, INVOICE_PAYMENT_AUDIT_FIELDS) },
        },
        manager,
      );
      await this.syncInvoice(manager, user, invoice, today);
      return created.id;
    });

    return {
      payment: toInvoicePayment(await this.payments.getDetailed(companyId, paymentId)),
      invoice: await this.invoiceService.detail(companyId, invoiceId),
    };
  }

  /** Recalcule montant payé, statut, date et moyen de règlement à partir des paiements. */
  private async syncInvoice(
    manager: EntityManager,
    user: AuthenticatedUser,
    invoice: Invoice,
    today: string,
  ): Promise<void> {
    const { companyId } = user;
    const { total, latest } = await this.payments.withManager(manager).summary(companyId, invoice.id);

    const after = await this.invoices.withManager(manager).changeInvoice(companyId, invoice.id, {
      amountPaid: total,
      ...settle(invoice, total, latest, today),
    });

    const diff = diffChanges(invoice, after, INVOICE_AUDIT_FIELDS);
    if (diff) {
      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.INVOICE,
          entityId: invoice.id,
          companyId,
          userId: user.id,
          changes: diff,
        },
        manager,
      );
    }
  }

  private assertAcceptsPayments(invoice: Invoice): void {
    if (invoice.type !== InvoiceDocumentType.INVOICE) {
      throw new BusinessRuleException('Seules les factures acceptent des paiements.');
    }
    switch (invoice.status) {
      case InvoicePaymentStatus.DRAFT:
        throw new ConflictAppException(
          "Émettez la facture avant d'enregistrer un paiement.",
          ErrorCode.INVALID_STATE,
        );
      case InvoicePaymentStatus.CANCELLED:
        throw new ConflictAppException('Cette facture est annulée.', ErrorCode.INVALID_STATE);
      case InvoicePaymentStatus.PAID:
        throw new ConflictAppException('Cette facture est déjà soldée.', ErrorCode.INVALID_STATE);
      default:
        return;
    }
  }
}