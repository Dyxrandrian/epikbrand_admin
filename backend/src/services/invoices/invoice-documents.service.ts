import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  ConvertQuoteDto,
  CreateCreditNoteDto,
  DuplicateInvoiceDto,
} from '../../dto/invoices/index.js';
import type { InvoiceItemDto } from '../../dto/invoices/invoice-item.dto.js';
import type { InvoiceItem } from '../../entities/invoice-item.entity.js';
import type { Invoice } from '../../entities/invoice.entity.js';
import { InvoiceDocumentType, InvoicePaymentStatus } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
} from '../../exceptions/index.js';
import { toLinkedDocument } from '../../mapper/invoice.mapper.js';
import { ClientRepository } from '../../repository/client.repository.js';
import { InvoiceRepository } from '../../repository/invoice.repository.js';
import { ProjectRepository } from '../../repository/project.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { INVOICE_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import type { DiscountInput } from './invoice-calculator.js';
import { assertDates, cents, prepareItems, totalsColumns } from './invoice-rules.js';
import { InvoiceService } from './invoice.service.js';

const { QUOTE, INVOICE, CREDIT_NOTE } = InvoiceDocumentType;
const { DRAFT, SENT, OVERDUE, PAID, CANCELLED } = InvoicePaymentStatus;

/** Lignes enregistrées vers entrées de calcul (copie fidèle, y compris remises et TVA par ligne). */
const toItemInputs = (items: readonly InvoiceItem[]): InvoiceItemDto[] =>
  items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unitPrice,
    vat_rate: item.vatRate,
    discount_type: item.discountType,
    discount_value: item.discountValue,
  }));

const discountOf = (doc: Invoice): DiscountInput => ({
  type: doc.discountType,
  value: doc.discountValue,
});

@Injectable()
export class InvoiceDocumentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly invoices: InvoiceRepository,
    private readonly clients: ClientRepository,
    private readonly projects: ProjectRepository,
    private readonly invoiceService: InvoiceService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Documents liés ----------

  async linkedDocuments(viewer: AuthenticatedUser, id: string) {
    const { companyId } = viewer;
    const doc = await this.invoices.getById(companyId, id);

    const [source, derived] = await Promise.all([
      doc.sourceDocumentId ? this.invoices.findById(companyId, doc.sourceDocumentId) : null,
      this.invoices.derivedFrom(companyId, id),
    ]);
    return {
      source: source ? toLinkedDocument(source) : null,
      derived: derived.map(toLinkedDocument),
    };
  }

  // ---------- Avoir ----------

  /**
   * Avoir en brouillon depuis une facture émise. Il s'émet ensuite par POST /invoices/:id/issue,
   * qui réduit alors le solde de la facture d'origine.
   */
  async createCreditNote(user: AuthenticatedUser, invoiceId: string, dto: CreateCreditNoteDto) {
    const { companyId } = user;
    const { today } = await this.invoiceService.context(companyId);
    const source = await this.invoices.getById(companyId, invoiceId);

    if (source.type !== INVOICE || ![SENT, OVERDUE, PAID].includes(source.status)) {
      throw new BusinessRuleException(
        'Un avoir ne peut être créé que sur une facture émise et non annulée.',
      );
    }

    const issueDate = dto.issue_date ?? today;
    assertDates(CREDIT_NOTE, issueDate, null, null);
    if (issueDate < source.issueDate) {
      throw new BusinessRuleException("La date de l'avoir ne peut pas précéder celle de la facture.");
    }

    const remaining = cents(source.totalTtc) - cents(source.creditedTotal);
    if (remaining <= 0) {
      throw new BusinessRuleException(
        'Cette facture est déjà intégralement créditée.',
        ErrorCode.CREDIT_EXCEEDS_INVOICE,
        { remaining: 0 },
      );
    }

    // Sans lignes précisées : copie de toute la facture (remise globale comprise)
    const copyAll = dto.items === undefined;
    const stored = copyAll ? await this.invoices.itemsFor(companyId, source.id) : [];
    const { rows, amounts } = prepareItems(
      copyAll ? toItemInputs(stored) : (dto.items as InvoiceItemDto[]),
      source.vatRate,
      copyAll ? discountOf(source) : { type: null, value: 0 },
    );

    if (cents(amounts.totalTtc) > remaining) {
      throw new BusinessRuleException(
        `Cet avoir (${amounts.totalTtc}) dépasse le montant restant à créditer sur la facture (${remaining / 100}).`,
        ErrorCode.CREDIT_EXCEEDS_INVOICE,
        { remaining: remaining / 100 },
      );
    }

    const id = await this.dataSource.transaction(async (manager) => {
      const repo = this.invoices.withManager(manager);
      const created = await repo.insertInvoice(companyId, {
        type: CREDIT_NOTE,
        status: DRAFT,
        invoiceNumber: null,
        clientId: source.clientId,
        projectId: source.projectId,
        sourceDocumentId: source.id,
        issueDate,
        dueDate: null,
        validUntil: null,
        currency: source.currency,
        vatRate: source.vatRate,
        discountType: copyAll ? source.discountType : null,
        discountValue: copyAll ? source.discountValue : 0,
        notes: dto.notes ?? null,
        paymentTerms: null,
        footer: dto.footer ?? null,
        ...totalsColumns(amounts),
      });
      await repo.replaceItems(companyId, created.id, rows);

      const fresh = await repo.getById(companyId, created.id);
      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.INVOICE,
          entityId: fresh.id,
          companyId,
          userId: user.id,
          changes: {
            after: {
              ...snapshot(fresh, INVOICE_AUDIT_FIELDS),
              items_count: rows.length,
              credit_of: source.id,
            },
          },
        },
        manager,
      );
      return fresh.id;
    });

    return this.invoiceService.detail(companyId, id);
  }

  // ---------- Devis : décision du client ----------

  accept(user: AuthenticatedUser, id: string) {
    return this.decideQuote(user, id, 'accept');
  }

  reject(user: AuthenticatedUser, id: string) {
    return this.decideQuote(user, id, 'reject');
  }

  /** La décision se change tant que le devis n'est pas converti ; la rejouer est sans effet. */
  private async decideQuote(user: AuthenticatedUser, id: string, decision: 'accept' | 'reject') {
    const { companyId } = user;
    const { today } = await this.invoiceService.context(companyId);

    await this.dataSource.transaction(async (manager) => {
      const repo = this.invoices.withManager(manager);
      const quote = await repo.lockById(companyId, id);
      this.assertSentQuote(quote);

      const accepting = decision === 'accept';
      if (accepting ? quote.acceptedAt : quote.rejectedAt) return;

      if (accepting) {
        if (quote.validUntil !== null && quote.validUntil < today) {
          throw new BusinessRuleException(
            `Ce devis a expiré le ${quote.validUntil} : prolongez sa validité avant de l'accepter.`,
            ErrorCode.QUOTE_EXPIRED,
          );
        }
      } else if (quote.acceptedAt && (await repo.activeInvoiceFromQuote(companyId, id))) {
        throw new ConflictAppException(
          "Ce devis a déjà été converti en facture : annulez d'abord la facture.",
          ErrorCode.INVALID_STATE,
        );
      }

      const now = new Date();
      const after = await repo.changeInvoice(
        companyId,
        id,
        accepting ? { acceptedAt: now, rejectedAt: null } : { rejectedAt: now, acceptedAt: null },
      );
      await this.audit.record(
        {
          action: AuditAction.QUOTE_DECIDED,
          entityType: AuditEntityType.INVOICE,
          entityId: id,
          companyId,
          userId: user.id,
          changes: diffChanges(quote, after, INVOICE_AUDIT_FIELDS),
        },
        manager,
      );
    });

    return this.invoiceService.detail(companyId, id);
  }

  // ---------- Devis : conversion en facture ----------

  /**
   * Idempotente : si une facture active existe déjà pour ce devis, elle est renvoyée telle quelle
   * (already_converted: true). Le verrou du devis rend cela sûr même en cas de double clic.
   */
  async convertQuote(user: AuthenticatedUser, quoteId: string, dto: ConvertQuoteDto) {
    const { companyId } = user;
    const { today } = await this.invoiceService.context(companyId);

    const outcome = await this.dataSource.transaction(async (manager) => {
      const repo = this.invoices.withManager(manager);
      const quote = await repo.lockById(companyId, quoteId);
      this.assertSentQuote(quote);

      const existing = await repo.activeInvoiceFromQuote(companyId, quoteId);
      if (existing) return { id: existing.id, created: false };

      if (quote.rejectedAt) {
        throw new BusinessRuleException(
          'Ce devis a été refusé par le client : il ne peut pas être converti en facture.',
        );
      }
      if (quote.validUntil !== null && quote.validUntil < today && !quote.acceptedAt) {
        throw new BusinessRuleException(
          `Ce devis a expiré le ${quote.validUntil} : prolongez sa validité avant de le convertir.`,
          ErrorCode.QUOTE_EXPIRED,
        );
      }

      // Client actif ; projet repris seulement s'il est encore actif
      await this.clients.withManager(manager).assertReference(companyId, quote.clientId, 'client_id');
      const project = quote.projectId
        ? await this.projects.withManager(manager).findById(companyId, quote.projectId)
        : null;

      const issueDate = dto.issue_date ?? today;
      const dueDate = dto.due_date ?? null;
      assertDates(INVOICE, issueDate, dueDate, null);

      const items = await repo.itemsFor(companyId, quote.id);
      const { rows, amounts } = prepareItems(toItemInputs(items), quote.vatRate, discountOf(quote));

      const created = await repo.insertInvoice(companyId, {
        type: INVOICE,
        status: DRAFT,
        invoiceNumber: null,
        clientId: quote.clientId,
        projectId: project?.id ?? null,
        sourceDocumentId: quote.id,
        issueDate,
        dueDate,
        validUntil: null,
        currency: quote.currency,
        vatRate: quote.vatRate,
        discountType: quote.discountType,
        discountValue: quote.discountValue,
        notes: quote.notes,
        paymentTerms: quote.paymentTerms,
        footer: quote.footer,
        ...totalsColumns(amounts),
      });
      await repo.replaceItems(companyId, created.id, rows);

      // Convertir vaut acceptation
      const quoteAfter = quote.acceptedAt
        ? quote
        : await repo.changeInvoice(companyId, quote.id, { acceptedAt: new Date() });

      const fresh = await repo.getById(companyId, created.id);
      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.INVOICE,
          entityId: fresh.id,
          companyId,
          userId: user.id,
          changes: {
            after: {
              ...snapshot(fresh, INVOICE_AUDIT_FIELDS),
              items_count: rows.length,
              converted_from: quote.id,
            },
          },
        },
        manager,
      );
      await this.audit.record(
        {
          action: AuditAction.CONVERT,
          entityType: AuditEntityType.INVOICE,
          entityId: quote.id,
          companyId,
          userId: user.id,
          changes: { after: { invoice_id: fresh.id, ...(diffChanges(quote, quoteAfter, INVOICE_AUDIT_FIELDS)?.after ?? {}) } },
        },
        manager,
      );
      return { id: fresh.id, created: true };
    });

    return {
      ...(await this.invoiceService.detail(companyId, outcome.id)),
      already_converted: !outcome.created,
    };
  }

  // ---------- Duplication ----------

  /** Copie en brouillon (devis ou facture), sans lien avec l'original. */
  async duplicate(user: AuthenticatedUser, id: string, dto: DuplicateInvoiceDto) {
    const { companyId } = user;
    const { today } = await this.invoiceService.context(companyId);
    const source = await this.invoices.getById(companyId, id);

    if (source.type === CREDIT_NOTE) {
      throw new BusinessRuleException(
        'Un avoir ne se duplique pas : créez un nouvel avoir depuis la facture concernée.',
      );
    }

    // Client actif de l'entreprise (celui d'origine peut être archivé : indiquez-en un autre)
    const clientId = dto.client_id ?? source.clientId;
    await this.clients.assertReference(companyId, clientId, 'client_id');

    const keepProject =
      clientId === source.clientId &&
      source.projectId !== null &&
      (await this.projects.findById(companyId, source.projectId)) !== null;

    const issueDate = dto.issue_date ?? today;
    const dueDate = dto.due_date ?? null;
    const validUntil = dto.valid_until ?? null;
    assertDates(source.type, issueDate, dueDate, validUntil);

    const items = await this.invoices.itemsFor(companyId, source.id);
    const { rows, amounts } = prepareItems(toItemInputs(items), source.vatRate, discountOf(source));

    const newId = await this.dataSource.transaction(async (manager) => {
      const repo = this.invoices.withManager(manager);
      const created = await repo.insertInvoice(companyId, {
        type: source.type,
        status: DRAFT,
        invoiceNumber: null,
        clientId,
        projectId: keepProject ? source.projectId : null,
        sourceDocumentId: null,
        issueDate,
        dueDate,
        validUntil,
        currency: source.currency,
        vatRate: source.vatRate,
        discountType: source.discountType,
        discountValue: source.discountValue,
        notes: source.notes,
        paymentTerms: source.paymentTerms,
        footer: source.footer,
        ...totalsColumns(amounts),
      });
      await repo.replaceItems(companyId, created.id, rows);

      const fresh = await repo.getById(companyId, created.id);
      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.INVOICE,
          entityId: fresh.id,
          companyId,
          userId: user.id,
          changes: {
            after: {
              ...snapshot(fresh, INVOICE_AUDIT_FIELDS),
              items_count: rows.length,
              duplicated_from: source.id,
            },
          },
        },
        manager,
      );
      return fresh.id;
    });

    return this.invoiceService.detail(companyId, newId);
  }

  // ---------- Outils internes ----------

  /** Devis émis et non annulé : 422 si ce n'est pas un devis, 409 si son état ne convient pas. */
  private assertSentQuote(quote: Invoice): void {
    if (quote.type !== QUOTE) {
      throw new BusinessRuleException('Cette action ne concerne que les devis.');
    }
    if (quote.status === DRAFT) {
      throw new ConflictAppException("Ce devis n'a pas encore été émis.", ErrorCode.INVALID_STATE);
    }
    if (quote.status === CANCELLED) {
      throw new ConflictAppException('Ce devis est annulé.', ErrorCode.INVALID_STATE);
    }
  }
}