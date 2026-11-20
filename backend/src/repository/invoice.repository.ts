import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { PaginatedResult } from '../dto/index.js';
import type { PaginationQueryDto, SortOrder } from '../dto/index.js';
import { InvoiceItem } from '../entities/invoice-item.entity.js';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceDocumentType, InvoicePaymentStatus } from '../enums/app.enums.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { DEFAULT_PREFIX, formatDocumentNumber } from '../services/invoices/invoice-rules.js';
import type { ItemRow } from '../services/invoices/invoice-rules.js';
import { escapeLike, searchWords } from './search.js';
import type { UpdateChanges } from './tenant.repository.js';
import { VersionedTenantRepository } from './versioned-tenant.repository.js';

export interface InvoiceFilters {
  types?: InvoiceDocumentType[];
  statuses?: InvoicePaymentStatus[];
  clientId?: string;
  projectId?: string;
  issueFrom?: string;
  issueTo?: string;
  dueFrom?: string;
  dueTo?: string;
  overdue?: boolean;
  unpaid?: boolean;
  /** Date du jour (AAAA-MM-JJ) dans le fuseau de l'entreprise. */
  today: string;
}

export interface CurrencyTotals {
  currency: string;
  count: number;
  total_ht: number;
  total_vat: number;
  total_ttc: number;
  amount_paid: number;
  credited_total: number;
  balance_due: number;
}

const OVERDUE_SQL = `COALESCE((
  "invoice"."type" = 'invoice'
  AND "invoice"."status" IN ('sent', 'overdue')
  AND "invoice"."due_date" < :fToday
  AND "invoice"."total_ttc" - "invoice"."amount_paid" - "invoice"."credited_total" > 0), false)`;

const UNPAID_SQL = `("invoice"."type" = 'invoice' AND "invoice"."status" IN ('sent', 'overdue'))`;

@Injectable()
export class InvoiceRepository extends VersionedTenantRepository<Invoice> {
  protected readonly alias = 'invoice';
  protected readonly label = 'Document';
  protected readonly sortableFields = {
    issue_date: 'issueDate',
    due_date: 'dueDate',
    invoice_number: 'invoiceNumber',
    total_ttc: 'totalTtc',
    status: 'status',
    created_at: 'createdAt',
  };
  protected readonly defaultSort: SortOrder = { issue_date: 'DESC', created_at: 'DESC' };

  constructor(@InjectRepository(Invoice) repo: Repository<Invoice>) {
    super(repo);
  }

  // ---------- Lectures ----------

  /** Liste paginée ; `meta.totals` regroupe, par devise, exactement les documents du filtre. */
  async list(
    companyId: string,
    query: PaginationQueryDto,
    filters: InvoiceFilters,
  ): Promise<PaginatedResult<Invoice>> {
    const qb = this.filtered(companyId, query, filters);
    this.applyIncludes(qb, query.include, {}); // aucune relation disponible : include est refusé
    qb.addSelect(['client.id', 'client.companyName']);

    const page = await this.paginate(qb, query);
    const totals = await this.totals(companyId, query, filters);
    return new PaginatedResult(page.items, page.total, page.page, page.perPage, { totals });
  }

  /** Document avec son client et son projet (id et nom seulement). */
  async getDetailed(companyId: string, id: string): Promise<Invoice> {
    const invoice = await this.scoped(companyId)
      .leftJoin('invoice.client', 'client')
      .addSelect(['client.id', 'client.companyName'])
      .leftJoin('invoice.project', 'project')
      .addSelect(['project.id', 'project.title'])
      .andWhere('invoice.id = :detailId', { detailId: id })
      .getOne();
    if (!invoice) throw new ResourceNotFoundException(this.label);
    return invoice;
  }

  /** Verrouille la ligne jusqu'à la fin de la transaction (via withManager()). */
  async lockById(companyId: string, id: string): Promise<Invoice> {
    const invoice = await this.scoped(companyId)
      .andWhere('invoice.id = :lockId', { lockId: id })
      .setLock('pessimistic_write')
      .getOne();
    if (!invoice) throw new ResourceNotFoundException(this.label);
    return invoice;
  }

  /** Lignes d'un document de l'entreprise, dans l'ordre. */
  itemsFor(companyId: string, invoiceId: string): Promise<InvoiceItem[]> {
    return this.repo.manager
      .getRepository(InvoiceItem)
      .createQueryBuilder('it')
      .innerJoin('it.invoice', 'inv')
      .where('inv.companyId = :itemsCompany', { itemsCompany: this.requireCompanyId(companyId) })
      .andWhere('it.invoiceId = :itemsInvoice', { itemsInvoice: invoiceId })
      .orderBy('it.position', 'ASC')
      .getMany();
  }

  /** Facture active (non annulée) issue de ce devis. */
  activeInvoiceFromQuote(companyId: string, quoteId: string): Promise<Invoice | null> {
    return this.scoped(companyId)
      .andWhere('invoice.sourceDocumentId = :quoteId', { quoteId })
      .andWhere(`invoice.type = 'invoice'`)
      .andWhere(`invoice.status <> 'cancelled'`)
      .getOne();
  }

  // ---------- Écritures ----------

  insertInvoice(companyId: string, data: Record<string, unknown>): Promise<Invoice> {
    return this.createOne(companyId, data as never);
  }

  changeInvoice(companyId: string, id: string, changes: Record<string, unknown>): Promise<Invoice> {
    return this.updateById(companyId, id, changes as unknown as UpdateChanges<Invoice>);
  }

  changeWithVersion(
    companyId: string,
    id: string,
    version: number,
    changes: Record<string, unknown>,
  ): Promise<Invoice> {
    return this.updateWithVersion(
      companyId,
      id,
      version,
      changes as unknown as UpdateChanges<Invoice>,
    );
  }

  /** Remplace toutes les lignes du document (suppression puis insertion, dans la transaction). */
  async replaceItems(companyId: string, invoiceId: string, rows: readonly ItemRow[]): Promise<void> {
    const manager = this.repo.manager;
    await manager.query(
      `WITH removed AS (
         DELETE FROM invoice_items it
          USING invoices i
          WHERE it.invoice_id = i.id AND i.company_id = $1 AND it.invoice_id = $2
          RETURNING it.id
       )
       SELECT COUNT(*)::int AS n FROM removed`,
      [this.requireCompanyId(companyId), invoiceId],
    );
    if (rows.length > 0) {
      await manager
        .getRepository(InvoiceItem)
        .insert(rows.map((row) => ({ ...row, invoiceId })) as never);
    }
  }

  /**
   * Numéro suivant : séquentiel par entreprise, type et année. L'incrément fait partie de la
   * transaction de l'appelant : si elle échoue, le numéro est rendu (jamais de trou).
   */
  async nextNumber(companyId: string, type: InvoiceDocumentType, year: number): Promise<string> {
    const rows: Array<{ prefix: string; last_number: number }> = await this.repo.manager.query(
      `INSERT INTO invoice_sequences (company_id, type, year, prefix, last_number)
       VALUES ($1::uuid, $2::invoice_sequences_type_enum, $3::smallint,
               COALESCE((SELECT s.prefix FROM invoice_sequences s
                          WHERE s.company_id = $1::uuid AND s.type = $2::invoice_sequences_type_enum
                          ORDER BY s.year DESC LIMIT 1), $4),
               1)
       ON CONFLICT (company_id, type, year)
       DO UPDATE SET last_number = invoice_sequences.last_number + 1
       RETURNING prefix, last_number`,
      [this.requireCompanyId(companyId), type, year, DEFAULT_PREFIX[type]],
    );
    return formatDocumentNumber(rows[0].prefix, year, rows[0].last_number);
  }

  // ---------- Outils internes ----------

  private filtered(
    companyId: string,
    query: PaginationQueryDto,
    f: InvoiceFilters,
  ): SelectQueryBuilder<Invoice> {
    const qb = this.scoped(companyId).leftJoin('invoice.client', 'client');

    if (f.types?.length) qb.andWhere('invoice.type IN (:...fTypes)', { fTypes: f.types });
    if (f.statuses?.length) qb.andWhere('invoice.status IN (:...fStatuses)', { fStatuses: f.statuses });
    if (f.clientId) qb.andWhere('invoice.clientId = :fClient', { fClient: f.clientId });
    if (f.projectId) qb.andWhere('invoice.projectId = :fProject', { fProject: f.projectId });
    if (f.issueFrom) qb.andWhere('invoice.issueDate >= :fIssueFrom', { fIssueFrom: f.issueFrom });
    if (f.issueTo) qb.andWhere('invoice.issueDate <= :fIssueTo', { fIssueTo: f.issueTo });
    if (f.dueFrom) qb.andWhere('invoice.dueDate >= :fDueFrom', { fDueFrom: f.dueFrom });
    if (f.dueTo) qb.andWhere('invoice.dueDate <= :fDueTo', { fDueTo: f.dueTo });
    if (f.overdue !== undefined) {
      qb.andWhere(f.overdue ? OVERDUE_SQL : `NOT ${OVERDUE_SQL}`, { fToday: f.today });
    }
    if (f.unpaid !== undefined) qb.andWhere(f.unpaid ? UNPAID_SQL : `NOT ${UNPAID_SQL}`);

    // Chaque mot doit apparaître dans le numéro ou dans le nom du client
    searchWords(query.q).forEach((word, index) => {
      const param = `qword_${index}`;
      qb.andWhere(
        `("invoice"."invoice_number" ILIKE '%' || :${param} || '%'
          OR f_unaccent("client"."company_name") ILIKE '%' || f_unaccent(CAST(:${param} AS text)) || '%')`,
        { [param]: escapeLike(word) },
      );
    });
    return qb;
  }

  private async totals(
    companyId: string,
    query: PaginationQueryDto,
    filters: InvoiceFilters,
  ): Promise<CurrencyTotals[]> {
    const rows = await this.filtered(companyId, query, filters)
      .select('"invoice"."currency"', 'currency')
      .addSelect('CAST(COUNT(*) AS int)', 'count')
      .addSelect('COALESCE(SUM("invoice"."total_ht"), 0)', 'total_ht')
      .addSelect('COALESCE(SUM("invoice"."total_vat"), 0)', 'total_vat')
      .addSelect('COALESCE(SUM("invoice"."total_ttc"), 0)', 'total_ttc')
      .addSelect('COALESCE(SUM("invoice"."amount_paid"), 0)', 'amount_paid')
      .addSelect('COALESCE(SUM("invoice"."credited_total"), 0)', 'credited_total')
      .addSelect(
        `COALESCE(SUM(GREATEST("invoice"."total_ttc" - "invoice"."amount_paid" - "invoice"."credited_total", 0))
           FILTER (WHERE "invoice"."type" = 'invoice' AND "invoice"."status" IN ('sent', 'overdue')), 0)`,
        'balance_due',
      )
      .groupBy('"invoice"."currency"')
      .orderBy('"invoice"."currency"', 'ASC')
      .getRawMany<Record<string, string | number>>();

    return rows.map((row) => ({
      currency: String(row.currency),
      count: Number(row.count),
      total_ht: Number(row.total_ht),
      total_vat: Number(row.total_vat),
      total_ttc: Number(row.total_ttc),
      amount_paid: Number(row.amount_paid),
      credited_total: Number(row.credited_total),
      balance_due: Number(row.balance_due),
    }));
  }

  /** Documents qui pointent vers celui-ci : avoirs d'une facture, facture issue d'un devis. */
  derivedFrom(companyId: string, sourceId: string): Promise<Invoice[]> {
    return this.scoped(companyId)
      .andWhere('invoice.sourceDocumentId = :derivedSource', { derivedSource: sourceId })
      .orderBy('invoice.createdAt', 'ASC')
      .addOrderBy('invoice.id', 'ASC')
      .getMany();
  }
}