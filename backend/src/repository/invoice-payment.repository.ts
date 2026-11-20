import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SortOrder } from '../dto/index.js';
import { InvoicePayment } from '../entities/invoice-payment.entity.js';
import type { PaymentMethod } from '../enums/app.enums.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { TenantRepository } from './tenant.repository.js';

export interface PaymentSummary {
  /** Somme exacte des paiements (calculée par la base, en décimal). */
  total: number;
  /** Paiement le plus récent : date de règlement de la facture. */
  latest: { paidAt: string; method: PaymentMethod } | null;
}

@Injectable()
export class InvoicePaymentRepository extends TenantRepository<InvoicePayment> {
  protected readonly alias = 'pay';
  protected readonly label = 'Paiement';
  protected readonly sortableFields = { paid_at: 'paidAt', created_at: 'createdAt' };
  protected readonly defaultSort: SortOrder = { paid_at: 'ASC' };

  constructor(@InjectRepository(InvoicePayment) repo: Repository<InvoicePayment>) {
    super(repo);
  }

  /** Paiements d'une facture de l'entreprise, avec leur auteur (id et nom seulement). */
  listForInvoice(companyId: string, invoiceId: string): Promise<InvoicePayment[]> {
    return this.scoped(companyId)
      .leftJoin('pay.createdBy', 'inc_creator')
      .addSelect(['inc_creator.id', 'inc_creator.name'])
      .andWhere('pay.invoiceId = :payInvoice', { payInvoice: invoiceId })
      .orderBy('pay.paidAt', 'ASC')
      .addOrderBy('pay.createdAt', 'ASC')
      .addOrderBy('pay.id', 'ASC')
      .getMany();
  }

  async getDetailed(companyId: string, id: string): Promise<InvoicePayment> {
    const payment = await this.scoped(companyId)
      .leftJoin('pay.createdBy', 'inc_creator')
      .addSelect(['inc_creator.id', 'inc_creator.name'])
      .andWhere('pay.id = :payId', { payId: id })
      .getOne();
    if (!payment) throw new ResourceNotFoundException(this.label);
    return payment;
  }

  /** 404 si le paiement n'existe pas, est d'une autre entreprise ou d'une autre facture. */
  async getForInvoice(
    companyId: string,
    invoiceId: string,
    paymentId: string,
  ): Promise<InvoicePayment> {
    const payment = await this.scoped(companyId)
      .andWhere('pay.id = :payId', { payId: paymentId })
      .andWhere('pay.invoiceId = :payInvoice', { payInvoice: invoiceId })
      .getOne();
    if (!payment) throw new ResourceNotFoundException(this.label);
    return payment;
  }

  insertPayment(companyId: string, data: Record<string, unknown>): Promise<InvoicePayment> {
    return this.createOne(companyId, data as never);
  }

  async summary(companyId: string, invoiceId: string): Promise<PaymentSummary> {
    const scope = [this.requireCompanyId(companyId), invoiceId];

    const totals: Array<{ total: string }> = await this.repo.manager.query(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
         FROM invoice_payments WHERE company_id = $1 AND invoice_id = $2`,
      scope,
    );
    const latest: Array<{ paidAt: string; method: PaymentMethod }> = await this.repo.manager.query(
      `SELECT to_char(paid_at, 'YYYY-MM-DD') AS "paidAt", method
         FROM invoice_payments
        WHERE company_id = $1 AND invoice_id = $2
        ORDER BY paid_at DESC, created_at DESC, id DESC
        LIMIT 1`,
      scope,
    );
    return { total: Number(totals[0].total), latest: latest[0] ?? null };
  }
}