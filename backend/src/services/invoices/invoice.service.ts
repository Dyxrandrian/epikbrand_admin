import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { mapDto } from '../../dto/map-dto.js';
import type {
  CreateInvoiceDto,
  InvoiceListQueryDto,
  UpdateInvoiceDto,
} from '../../dto/invoices/index.js';
import type { Client } from '../../entities/client.entity.js';
import type { Invoice } from '../../entities/invoice.entity.js';
import { InvoiceDocumentType, InvoicePaymentStatus } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
} from '../../exceptions/index.js';
import { toInvoice, toInvoiceDetail } from '../../mapper/invoice.mapper.js';
import { ClientRepository } from '../../repository/client.repository.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { InvoiceRepository } from '../../repository/invoice.repository.js';
import { ProjectRepository } from '../../repository/project.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { INVOICE_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { todayIn } from '../projects/project-dates.js';
import { computeDocument, lineInputOf } from './invoice-calculator.js';
import type { DiscountInput } from './invoice-calculator.js';
import {
  addMoney,
  assertDates,
  balanceDue,
  buildClientSnapshot,
  buildSellerSnapshot,
  cents,
  normalizeDiscount,
  openStatus,
  prepareItems,
  totalsColumns,
} from './invoice-rules.js';
import type { ItemRow } from './invoice-rules.js';

const { DRAFT, SENT, OVERDUE, PAID, CANCELLED } = InvoicePaymentStatus;
const { QUOTE, INVOICE, CREDIT_NOTE } = InvoiceDocumentType;

/** Champs qui ne se modifient plus une fois le document émis. */
const FROZEN_AFTER_ISSUE = [
  'client_id',
  'issue_date',
  'currency',
  'vat_rate',
  'discount_type',
  'discount_value',
  'items',
] as const;

const UPDATE_MAP = {
  issue_date: 'issueDate',
  due_date: 'dueDate',
  valid_until: 'validUntil',
  currency: 'currency',
  vat_rate: 'vatRate',
  notes: 'notes',
  payment_terms: 'paymentTerms',
  footer: 'footer',
} as const;

@Injectable()
export class InvoiceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly invoices: InvoiceRepository,
    private readonly clients: ClientRepository,
    private readonly projects: ProjectRepository,
    private readonly companies: CompanyRepository,
    private readonly audit: AuditService,
  ) {}

  // ---------- Lectures ----------

  async list(viewer: AuthenticatedUser, query: InvoiceListQueryDto) {
    const { today } = await this.context(viewer.companyId);
    const result = await this.invoices.list(viewer.companyId, query, {
      types: query.type,
      statuses: query.status,
      clientId: query.client_id,
      projectId: query.project_id,
      issueFrom: query.issue_from,
      issueTo: query.issue_to,
      dueFrom: query.due_from,
      dueTo: query.due_to,
      overdue: query.overdue,
      unpaid: query.unpaid,
      today,
    });
    return result.map((invoice) => toInvoice(invoice, today));
  }

  get(viewer: AuthenticatedUser, id: string) {
    return this.detail(viewer.companyId, id);
  }

  // ---------- Création et modification ----------

  async create(user: AuthenticatedUser, dto: CreateInvoiceDto) {
    const { companyId } = user;
    const { company, today } = await this.context(companyId);

    // Client actif et projet de l'entreprise (sinon 422 sur le champ concerné)
    await this.clients.assertReference(companyId, dto.client_id, 'client_id');
    if (dto.project_id) await this.projects.assertReference(companyId, dto.project_id, 'project_id');

    const issueDate = dto.issue_date ?? today;
    const dueDate = dto.due_date ?? null;
    const validUntil = dto.valid_until ?? null;
    assertDates(dto.type, issueDate, dueDate, validUntil);

    const vatRate = dto.vat_rate ?? company.defaultVatRate;
    const discount = normalizeDiscount(dto.discount_type, dto.discount_value, '');
    const { rows, amounts } = prepareItems(dto.items ?? [], vatRate, discount);

    const id = await this.dataSource.transaction(async (manager) => {
      const repo = this.invoices.withManager(manager);
      const created = await repo.insertInvoice(companyId, {
        type: dto.type,
        status: DRAFT,
        invoiceNumber: null, // attribué à l'émission
        clientId: dto.client_id,
        projectId: dto.project_id ?? null,
        issueDate,
        dueDate,
        validUntil,
        currency: dto.currency ?? company.defaultCurrency,
        vatRate,
        discountType: discount.type,
        discountValue: discount.value,
        notes: dto.notes ?? null,
        paymentTerms: dto.payment_terms ?? null,
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
          changes: { after: { ...snapshot(fresh, INVOICE_AUDIT_FIELDS), items_count: rows.length } },
        },
        manager,
      );
      return fresh.id;
    });

    return this.detail(companyId, id);
  }

  /**
   * Brouillon : tout se modifie, `items` remplace toutes les lignes.
   * Document émis : seuls l'échéance, la validité, les notes, les conditions, le pied de page
   * et le projet. Document annulé : plus rien.
   */
  async update(user: AuthenticatedUser, id: string, dto: UpdateInvoiceDto) {
    const { companyId } = user;
    const { today } = await this.context(companyId);

    await this.dataSource.transaction(async (manager) => {
      const repo = this.invoices.withManager(manager);
      const before = await repo.getById(companyId, id);
      this.assertEditable(before, dto);

      const issueDate = dto.issue_date ?? before.issueDate;
      const dueDate = dto.due_date !== undefined ? dto.due_date : before.dueDate;
      const validUntil = dto.valid_until !== undefined ? dto.valid_until : before.validUntil;
      assertDates(before.type, issueDate, dueDate, validUntil);

      const changes: Record<string, unknown> = mapDto(dto, UPDATE_MAP);

      if (dto.client_id !== undefined && dto.client_id !== before.clientId) {
        await this.clients.assertReference(companyId, dto.client_id, 'client_id');
        changes.clientId = dto.client_id;
      }
      if (dto.project_id !== undefined && dto.project_id !== before.projectId) {
        if (dto.project_id !== null) {
          await this.projects.assertReference(companyId, dto.project_id, 'project_id');
        }
        changes.projectId = dto.project_id;
      }

      // Remise globale : null retire la remise
      const discountTouched = dto.discount_type !== undefined || dto.discount_value !== undefined;
      let discount: DiscountInput = { type: before.discountType, value: before.discountValue };
      if (discountTouched) {
        const type = dto.discount_type !== undefined ? dto.discount_type : before.discountType;
        const value =
          type === null
            ? 0
            : dto.discount_value !== undefined
              ? (dto.discount_value ?? 0)
              : before.discountValue;
        discount = normalizeDiscount(type, value, '');
        changes.discountType = discount.type;
        changes.discountValue = discount.value;
      }

      // Totaux : recalculés dès que les lignes ou la remise globale changent
      let rows: ItemRow[] | null = null;
      if (dto.items !== undefined) {
        const prepared = prepareItems(dto.items, dto.vat_rate ?? before.vatRate, discount);
        rows = prepared.rows;
        Object.assign(changes, totalsColumns(prepared.amounts));
      } else if (discountTouched) {
        const stored = await repo.itemsFor(companyId, id);
        Object.assign(changes, totalsColumns(computeDocument(stored.map(lineInputOf), discount)));
      }

      // Nouvelle échéance : le statut suit immédiatement (en retard ou non)
      if (
        dto.due_date !== undefined &&
        before.type === INVOICE &&
        (before.status === SENT || before.status === OVERDUE)
      ) {
        changes.status = openStatus(dueDate, today);
      }

      if (Object.keys(changes).length === 0) return;

      // 409 VERSION_CONFLICT si la version envoyée n'est plus la bonne. Passe AVANT les lignes :
      // une requête périmée ne touche à rien.
      const after = await repo.changeWithVersion(companyId, id, dto.version, changes);
      if (rows) await repo.replaceItems(companyId, id, rows);

      const diff = diffChanges(before, after, INVOICE_AUDIT_FIELDS);
      if (diff || rows) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.INVOICE,
            entityId: id,
            companyId,
            userId: user.id,
            changes: {
              before: diff?.before ?? {},
              after: { ...(diff?.after ?? {}), ...(rows ? { items_replaced: rows.length } : {}) },
            },
          },
          manager,
        );
      }
    });

    return this.detail(companyId, id);
  }

  /** Seuls les brouillons se suppriment (le numéro n'a jamais été attribué : aucun trou). */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const { companyId } = user;
    await this.dataSource.transaction(async (manager) => {
      const repo = this.invoices.withManager(manager);
      const doc = await repo.lockById(companyId, id);
      if (doc.status !== DRAFT) {
        throw new ConflictAppException(
          "Seuls les brouillons peuvent être supprimés. Un document émis s'annule, ou se corrige par un avoir.",
          ErrorCode.INVALID_STATE,
        );
      }

      const before = snapshot(doc, INVOICE_AUDIT_FIELDS);
      await repo.deleteById(companyId, id); // les lignes partent en cascade

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entityType: AuditEntityType.INVOICE,
          entityId: id,
          companyId,
          userId: user.id,
          changes: { before },
        },
        manager,
      );
    });
  }

  // ---------- Émission et annulation ----------

  /**
   * Brouillon vers « envoyé » : attribue le numéro, fige le client et l'entreprise, enregistre
   * sent_at. (L'envoi par e-mail, étape 17, passe par ici.)
   */
  async issue(user: AuthenticatedUser, id: string) {
    const { companyId } = user;
    const { company, today } = await this.context(companyId);

    await this.dataSource.transaction(async (manager) => {
      const repo = this.invoices.withManager(manager);
      const doc = await repo.lockById(companyId, id);

      if (doc.status !== DRAFT) {
        throw new ConflictAppException('Ce document a déjà été émis.', ErrorCode.INVALID_STATE);
      }
      const items = await repo.itemsFor(companyId, id);
      if (items.length === 0) {
        throw new BusinessRuleException("Ajoutez au moins une ligne avant d'émettre ce document.");
      }
      if (!(doc.totalTtc > 0)) {
        throw new BusinessRuleException('Le total du document doit être supérieur à zéro pour être émis.');
      }
      if (doc.issueDate > today) {
        throw new BusinessRuleException(
          "La date d'émission est dans le futur : corrigez-la avant d'émettre ce document.",
        );
      }

      const clients = this.clients.withManager(manager);
      if (doc.type !== CREDIT_NOTE) await clients.assertReference(companyId, doc.clientId, 'client_id');
      const client = await clients.getByIdIncludingArchived(companyId, doc.clientId);

      // Avoir : on verrouille la facture d'origine (toujours après l'avoir : pas d'interblocage)
      const source = doc.type === CREDIT_NOTE ? await this.lockCreditSource(repo, doc) : null;

      const number = await repo.nextNumber(companyId, doc.type, Number(doc.issueDate.slice(0, 4)));
      const late = doc.type === INVOICE && doc.dueDate !== null && doc.dueDate < today;

      const after = await repo.changeInvoice(companyId, id, {
        status: late ? OVERDUE : SENT,
        invoiceNumber: number,
        sentAt: new Date(),
        clientSnapshot: buildClientSnapshot(client),
        sellerSnapshot: buildSellerSnapshot(company),
      });
      await this.audit.record(
        {
          action: AuditAction.ISSUE,
          entityType: AuditEntityType.INVOICE,
          entityId: id,
          companyId,
          userId: user.id,
          changes: diffChanges(doc, after, INVOICE_AUDIT_FIELDS),
        },
        manager,
      );

      if (source) await this.applyCredit(repo, manager, user, source, after, today);
    });

    return this.detail(companyId, id);
  }

  /**
   * Facture envoyée par erreur, ou devis. Une facture avec paiements ou avoirs se corrige par
   * un avoir. Idempotent.
   */
  async cancel(user: AuthenticatedUser, id: string) {
    const { companyId } = user;

    await this.dataSource.transaction(async (manager) => {
      const repo = this.invoices.withManager(manager);
      const doc = await repo.lockById(companyId, id);

      if (doc.status === CANCELLED) return;
      if (doc.status === DRAFT) {
        throw new ConflictAppException(
          "Un brouillon se supprime, il ne s'annule pas.",
          ErrorCode.INVALID_STATE,
        );
      }
      if (doc.type === CREDIT_NOTE) {
        throw new BusinessRuleException("Un avoir émis ne peut pas être annulé.");
      }
      if (doc.type === INVOICE) {
        if (doc.status === PAID || cents(doc.amountPaid) > 0 || cents(doc.creditedTotal) > 0) {
          throw new BusinessRuleException(
            'Cette facture a des paiements ou des avoirs : corrigez-la par un avoir.',
          );
        }
      } else if (await repo.activeInvoiceFromQuote(companyId, id)) {
        throw new ConflictAppException(
          "Ce devis a été converti en facture : annulez d'abord la facture.",
          ErrorCode.INVALID_STATE,
        );
      }

      const after = await repo.changeInvoice(companyId, id, { status: CANCELLED });
      await this.audit.record(
        {
          action: AuditAction.CANCEL,
          entityType: AuditEntityType.INVOICE,
          entityId: id,
          companyId,
          userId: user.id,
          changes: diffChanges(doc, after, INVOICE_AUDIT_FIELDS),
        },
        manager,
      );
    });

    return this.detail(companyId, id);
  }

  // ---------- Outils internes ----------

  async context(companyId: string) {
    const company = await this.companies.getById(companyId);
    return { company, today: todayIn(company.timezone) };
  }

  async detail(companyId: string, id: string) {
    const { company, today } = await this.context(companyId);
    const invoice = await this.invoices.getDetailed(companyId, id);

    const [items, liveClient, source] = await Promise.all([
      this.invoices.itemsFor(companyId, id),
      invoice.clientSnapshot
        ? Promise.resolve(null)
        : this.clients.getByIdIncludingArchived(companyId, invoice.clientId),
      invoice.sourceDocumentId
        ? this.invoices.findById(companyId, invoice.sourceDocumentId)
        : Promise.resolve(null),
    ]);

    return toInvoiceDetail(invoice, {
      today,
      items,
      seller: invoice.sellerSnapshot ?? buildSellerSnapshot(company),
      client: invoice.clientSnapshot ?? buildClientSnapshot(liveClient as Client),
      source,
    });
  }

  private assertEditable(doc: Invoice, dto: UpdateInvoiceDto): void {
    if (doc.status === CANCELLED) {
      throw new BusinessRuleException("Un document annulé n'est plus modifiable.", ErrorCode.DOCUMENT_LOCKED);
    }
    if (doc.type === CREDIT_NOTE && dto.client_id !== undefined && dto.client_id !== doc.clientId) {
      throw new BusinessRuleException("Le client d'un avoir ne peut pas être modifié.");
    }
    if (doc.status === DRAFT) return;

    const touched = FROZEN_AFTER_ISSUE.filter((field) => dto[field] !== undefined);
    if (touched.length > 0) {
      throw new BusinessRuleException(
        `Ce document a été émis : ${touched.join(', ')} ne peuvent plus être modifiés. Corrigez-le par un avoir, ou dupliquez-le.`,
        ErrorCode.DOCUMENT_LOCKED,
      );
    }
  }

  /** Facture d'origine d'un avoir : émise, même devise, et montant restant à créditer suffisant. */
  private async lockCreditSource(repo: InvoiceRepository, credit: Invoice): Promise<Invoice> {
    const source = await repo.lockById(credit.companyId, credit.sourceDocumentId as string);

    if (source.type !== INVOICE || source.status === DRAFT || source.status === CANCELLED) {
      throw new BusinessRuleException("La facture d'origine n'accepte pas d'avoir (non émise ou annulée).");
    }
    if (source.currency !== credit.currency) {
      throw new BusinessRuleException("L'avoir doit être dans la même devise que sa facture.");
    }
    const remaining = cents(source.totalTtc) - cents(source.creditedTotal);
    if (cents(credit.totalTtc) > remaining) {
      throw new BusinessRuleException(
        `Cet avoir (${credit.totalTtc}) dépasse le montant restant à créditer sur la facture (${remaining / 100}).`,
        ErrorCode.CREDIT_EXCEEDS_INVOICE,
        { remaining: remaining / 100 },
      );
    }
    return source;
  }

  /** L'avoir émis réduit le solde de la facture ; à zéro, la facture est soldée. */
  private async applyCredit(
    repo: InvoiceRepository,
    manager: Parameters<AuditService['record']>[1],
    user: AuthenticatedUser,
    source: Invoice,
    credit: Invoice,
    today: string,
  ): Promise<void> {
    const creditedTotal = addMoney(source.creditedTotal, credit.totalTtc);
    const patch: Record<string, unknown> = { creditedTotal };

    const settled = balanceDue({
      totalTtc: source.totalTtc,
      amountPaid: source.amountPaid,
      creditedTotal,
    }) === 0;
    if (settled && source.status !== PAID) {
      patch.status = PAID;
      patch.paidAt = today;
      patch.paymentMethod = null; // soldée par avoir, pas par un règlement
    }

    const updated = await repo.changeInvoice(source.companyId, source.id, patch);
    await this.audit.record(
      {
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.INVOICE,
        entityId: source.id,
        companyId: source.companyId,
        userId: user.id,
        changes: diffChanges(source, updated, INVOICE_AUDIT_FIELDS),
      },
      manager,
    );
  }
}