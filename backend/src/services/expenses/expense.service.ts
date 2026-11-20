import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { PaginatedResult } from '../../dto/index.js';
import type {
  CreateExpenseDto,
  ExpenseListQueryDto,
  PayExpenseDto,
  UpdateExpenseDto,
} from '../../dto/expenses/index.js';
import type { Expense } from '../../entities/expense.entity.js';
import { ExpenseStatus, MediaPurpose } from '../../enums/app.enums.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import {
  AccessDeniedException,
  BusinessRuleException,
  ConflictAppException,
  ErrorCode,
  InvalidReferenceException,
  ValidationFailedException,
} from '../../exceptions/index.js';
import { toExpense, toExpenseDetail } from '../../mapper/expense.mapper.js';
import type { ReceiptInfo } from '../../mapper/expense.mapper.js';
import { ExpenseCategoryRepository } from '../../repository/config-lists.repositories.js';
import { CompanyRepository } from '../../repository/company.repository.js';
import { ExpenseRepository } from '../../repository/expense.repository.js';
import { FileRepository } from '../../repository/file.repository.js';
import { ProjectRepository } from '../../repository/project.repository.js';
import { isManagerOrAdmin } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { EXPENSE_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { privateFilePath, receiptIdFromUrl } from '../files/file-paths.js';
import { FileStorage } from '../files/storage/file-storage.js';
import { notificationTemplates } from '../notifications/notification-templates.js';
import { NotificationService } from '../notifications/notification.service.js';
import { todayIn } from '../projects/project-dates.js';
import { viewerOf } from '../tasks/task-rules.js';
import {
  amountMismatch,
  itemsTotal,
  resolveAmounts,
  sameAmount,
} from './expense-amounts.js';
import { assertDueDate, resolveRecurrence, toItemRows } from './expense-rules.js';

const { PENDING, PAID, CANCELLED } = ExpenseStatus;

/** Un collaborateur ne renseigne pas ces champs (sauf user_id = lui-même). */
const COLLABORATOR_FORBIDDEN = ['user_id', 'due_date', 'is_recurring', 'recurrence'] as const;

/** Dépense payée : seuls ces champs restent modifiables. */
const PAID_EDITABLE: readonly string[] = ['title', 'category_id', 'project_id'];

@Injectable()
export class ExpenseService {
  private readonly logger = new Logger(ExpenseService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly expenses: ExpenseRepository,
    private readonly categories: ExpenseCategoryRepository,
    private readonly projects: ProjectRepository,
    private readonly companies: CompanyRepository,
    private readonly files: FileRepository,
    private readonly storage: FileStorage,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------- Lectures ----------

  async list(viewer: AuthenticatedUser, query: ExpenseListQueryDto) {
    if (!isManagerOrAdmin(viewer) && query.user_id !== undefined) {
      throw new AccessDeniedException(
        'Le filtre user_id est réservé aux administrateurs et managers.',
      );
    }
    const { company, today } = await this.context(viewer.companyId);

    const result = await this.expenses.list(viewer.companyId, query, viewerOf(viewer), {
      statuses: query.status,
      categoryId: query.category_id,
      projectId: query.project_id,
      userId: query.user_id,
      supplier: query.supplier,
      dateFrom: query.date_from,
      dateTo: query.date_to,
      dueFrom: query.due_from,
      dueTo: query.due_to,
      overdue: query.overdue,
      recurring: query.recurring,
      recurrence: query.recurrence,
      generatedFrom: query.generated_from,
      hasReceipt: query.has_receipt,
      awaitingValidation: query.awaiting_validation,
      today,
    });

    return new PaginatedResult(
      result.items.map((expense) => toExpense(expense, today)),
      result.total,
      result.page,
      result.perPage,
      {
        totals: { currency: company.defaultCurrency, ...(result.extra.totals as object) },
      },
    );
  }

  /** Fiche avec lignes et justificatif ; 404 si la dépense n'est pas visible par ce lecteur. */
  async get(viewer: AuthenticatedUser, id: string) {
    const { companyId } = viewer;
    const { today } = await this.context(companyId);

    const expense = await this.expenses.getDetailed(companyId, id, viewerOf(viewer));
    const [items, receipt] = await Promise.all([
      this.expenses.itemsFor(companyId, id),
      this.loadReceipt(companyId, expense.receiptUrl),
    ]);
    return toExpenseDetail(expense, { today, items, receipt });
  }

  // ---------- Création ----------

  async create(user: AuthenticatedUser, dto: CreateExpenseDto) {
    const { companyId } = user;
    const privileged = isManagerOrAdmin(user);
    const { today } = await this.context(companyId);

    if (!privileged) this.assertCollaboratorFields(dto, user.id);

    const expenseDate = dto.expense_date ?? today;
    if (!privileged && expenseDate > today) {
      throw new BusinessRuleException('La date de la dépense ne peut pas être dans le futur.');
    }
    const dueDate = dto.due_date ?? null;
    assertDueDate(expenseDate, dueDate);

    const recurrence = resolveRecurrence(
      { isRecurring: dto.is_recurring, recurrence: dto.recurrence },
      { isRecurring: false, recurrence: null, parentExpenseId: null },
    );

    // Montants : HT (ou somme des lignes), puis TVA ; les lignes doivent concorder avec le HT
    const itemRows = toItemRows(dto.items ?? []);
    const itemsHt = itemRows.length > 0 ? itemsTotal(itemRows) : null;
    if (dto.amount_ht === undefined && itemsHt === null) {
      throw new ValidationFailedException([
        {
          field: 'amount_ht',
          reason: 'amountRequired',
          message: 'Indiquez amount_ht ou des lignes (items).',
        },
      ]);
    }
    const ht = dto.amount_ht ?? (itemsHt as number);
    if (itemsHt !== null && !sameAmount(itemsHt, ht)) {
      throw amountMismatch(
        `Le total HT (${ht}) ne correspond pas à la somme des lignes (${itemsHt}).`,
        { items_total: itemsHt, amount_ht: ht },
      );
    }
    const amounts = resolveAmounts({
      ht,
      vatAmount: dto.vat_amount,
      vatRate: dto.vat_rate,
      ttc: dto.amount_ttc,
    });

    const userId = privileged ? (dto.user_id ?? null) : user.id;

    const created = await this.dataSource.transaction(async (manager) => {
      await this.assertReferences(manager, user, privileged, {
        categoryId: dto.category_id,
        projectId: dto.project_id,
        userId: privileged ? dto.user_id : undefined,
      });

      const repo = this.expenses.withManager(manager);
      const now = new Date();
      const inserted = await repo.insertExpense(companyId, {
        title: dto.title,
        supplierName: dto.supplier_name,
        categoryId: dto.category_id ?? null,
        projectId: dto.project_id ?? null,
        userId,
        ...amounts,
        status: PENDING,
        isRecurring: recurrence.isRecurring,
        recurrence: recurrence.recurrence,
        parentExpenseId: null,
        expenseDate,
        dueDate,
        paidAt: null,
        paymentMethod: null,
        receiptUrl: null,
        // Créée par un admin ou un manager : validée d'office
        validatedAt: privileged ? now : null,
        validatedById: privileged ? user.id : null,
      });
      await repo.replaceItems(companyId, inserted.id, itemRows);

      const fresh = await repo.getById(companyId, inserted.id);
      await this.audit.record(
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.EXPENSE,
          entityId: fresh.id,
          companyId,
          userId: user.id,
          changes: {
            after: { ...snapshot(fresh, EXPENSE_AUDIT_FIELDS), items_count: itemRows.length },
          },
        },
        manager,
      );
      return fresh;
    });

    // Note de frais d'un collaborateur : les managers sont prévenus
    if (!privileged) {
      await this.notifications.notifyManagers({
        companyId,
        actorId: user.id,
        ...notificationTemplates.expenseSubmitted(
          { id: created.id, title: created.title },
          user.name,
        ),
      });
    }
    return this.get(user, created.id);
  }

  // ---------- Modification ----------

  /**
   * Admin et manager : tous les champs d'une dépense en attente ; titre, catégorie et projet
   * d'une dépense payée ; rien sur une dépense annulée.
   * Collaborateur : sa note de frais tant qu'elle n'est ni validée, ni payée, ni annulée.
   */
  async update(viewer: AuthenticatedUser, id: string, dto: UpdateExpenseDto) {
    const { companyId } = viewer;
    const privileged = isManagerOrAdmin(viewer);
    const { today } = await this.context(companyId);

    if (!privileged) this.assertCollaboratorFields(dto, viewer.id);
    const itemRows = dto.items !== undefined ? toItemRows(dto.items) : null;

    await this.dataSource.transaction(async (manager) => {
      const repo = this.expenses.withManager(manager);
      const before = await repo.lockById(companyId, id, viewerOf(viewer)); // 404 si invisible
      this.assertEditable(before, dto, privileged);

      const changes: Record<string, unknown> = {};
      if (dto.title !== undefined) changes.title = dto.title;
      if (dto.supplier_name !== undefined) changes.supplierName = dto.supplier_name;

      // Dates
      const expenseDate = dto.expense_date ?? before.expenseDate;
      if (!privileged && dto.expense_date !== undefined && expenseDate > today) {
        throw new BusinessRuleException('La date de la dépense ne peut pas être dans le futur.');
      }
      const dueDate = dto.due_date !== undefined ? dto.due_date : before.dueDate;
      assertDueDate(expenseDate, dueDate);
      if (dto.expense_date !== undefined) changes.expenseDate = expenseDate;
      if (dto.due_date !== undefined) changes.dueDate = dueDate;

      // Références (vérifiées seulement si elles changent)
      const categoryChanged = dto.category_id !== undefined && dto.category_id !== before.categoryId;
      const projectChanged = dto.project_id !== undefined && dto.project_id !== before.projectId;
      const userChanged = dto.user_id !== undefined && dto.user_id !== before.userId;
      await this.assertReferences(manager, viewer, privileged, {
        categoryId: categoryChanged ? dto.category_id : undefined,
        projectId: projectChanged ? dto.project_id : undefined,
        userId: userChanged ? dto.user_id : undefined,
      });
      if (categoryChanged) changes.categoryId = dto.category_id;
      if (projectChanged) changes.projectId = dto.project_id;
      if (userChanged) changes.userId = dto.user_id;

      // Montants et lignes
      const amountsTouched =
        itemRows !== null ||
        dto.amount_ht !== undefined ||
        dto.vat_amount !== undefined ||
        dto.vat_rate !== undefined ||
        dto.amount_ttc !== undefined;

      if (amountsTouched) {
        const finalItems = itemRows ?? (await repo.itemsFor(companyId, id));
        const itemsHt = itemRows && itemRows.length > 0 ? itemsTotal(itemRows) : null;
        const ht = dto.amount_ht ?? itemsHt ?? before.amountHt;

        // Sans nouvelle indication de TVA, le montant existant est conservé
        const vatGiven =
          dto.vat_amount !== undefined ||
          dto.vat_rate !== undefined ||
          dto.amount_ttc !== undefined;
        const amounts = resolveAmounts({
          ht,
          vatAmount: vatGiven ? dto.vat_amount : before.vatAmount,
          vatRate: dto.vat_rate,
          ttc: dto.amount_ttc,
        });

        if (finalItems.length > 0) {
          const total = itemsTotal(finalItems);
          if (!sameAmount(total, amounts.amountHt)) {
            throw amountMismatch(
              `Le total HT (${amounts.amountHt}) ne correspond pas à la somme des lignes (${total}). Mettez les lignes à jour, ou retirez-les avec items: [].`,
              { items_total: total, amount_ht: amounts.amountHt },
            );
          }
        }
        Object.assign(changes, amounts);
      }

      // Récurrence (admin et manager)
      if (dto.is_recurring !== undefined || dto.recurrence !== undefined) {
        const recurrence = resolveRecurrence(
          { isRecurring: dto.is_recurring, recurrence: dto.recurrence },
          {
            isRecurring: before.isRecurring,
            recurrence: before.recurrence,
            parentExpenseId: before.parentExpenseId,
          },
        );
        changes.isRecurring = recurrence.isRecurring;
        changes.recurrence = recurrence.recurrence;
      }

      const hasChanges = Object.keys(changes).length > 0;
      if (!hasChanges && itemRows === null) return;

      const after = hasChanges ? await repo.changeExpense(companyId, id, changes) : before;
      if (itemRows) await repo.replaceItems(companyId, id, itemRows);

      const diff = diffChanges(before, after, EXPENSE_AUDIT_FIELDS);
      if (diff || itemRows) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.EXPENSE,
            entityId: id,
            companyId,
            userId: viewer.id,
            changes: {
              before: diff?.before ?? {},
              after: {
                ...(diff?.after ?? {}),
                ...(itemRows ? { items_replaced: itemRows.length } : {}),
              },
            },
          },
          manager,
        );
      }
    });

    return this.get(viewer, id);
  }

  // ---------- Validation, paiement, annulation ----------

  /** Valide une note de frais en attente. Idempotent. */
  async validate(user: AuthenticatedUser, id: string) {
    const { companyId } = user;

    const outcome = await this.dataSource.transaction(async (manager) => {
      const repo = this.expenses.withManager(manager);
      const before = await repo.lockById(companyId, id, viewerOf(user));

      if (before.status === CANCELLED) {
        throw new ConflictAppException('Cette dépense est annulée.', ErrorCode.INVALID_STATE);
      }
      if (before.status === PAID || before.validatedAt !== null) {
        return { expense: before, changed: false };
      }

      const after = await repo.changeExpense(companyId, id, {
        validatedAt: new Date(),
        validatedById: user.id,
      });
      await this.audit.record(
        {
          action: AuditAction.VALIDATE,
          entityType: AuditEntityType.EXPENSE,
          entityId: id,
          companyId,
          userId: user.id,
          changes: diffChanges(before, after, EXPENSE_AUDIT_FIELDS),
        },
        manager,
      );
      return { expense: after, changed: true };
    });

    if (outcome.changed) await this.notifyOwner(user, outcome.expense, 'validated');
    return this.get(user, id);
  }

  /** Marque payée : date et moyen de paiement enregistrés. Payer vaut validation. */
  async pay(user: AuthenticatedUser, id: string, dto: PayExpenseDto) {
    const { companyId } = user;
    const { today } = await this.context(companyId);

    const paidAt = dto.paid_at ?? today;
    if (paidAt > today) {
      throw new BusinessRuleException('La date du paiement ne peut pas être dans le futur.');
    }

    const after = await this.dataSource.transaction(async (manager) => {
      const repo = this.expenses.withManager(manager);
      const before = await repo.lockById(companyId, id, viewerOf(user));

      if (before.status === PAID) {
        throw new ConflictAppException('Cette dépense est déjà payée.', ErrorCode.INVALID_STATE);
      }
      if (before.status === CANCELLED) {
        throw new ConflictAppException('Cette dépense est annulée.', ErrorCode.INVALID_STATE);
      }

      const updated = await repo.changeExpense(companyId, id, {
        status: PAID,
        paidAt,
        paymentMethod: dto.method,
        validatedAt: before.validatedAt ?? new Date(),
        validatedById: before.validatedById ?? user.id,
      });
      await this.audit.record(
        {
          action: AuditAction.PAY,
          entityType: AuditEntityType.EXPENSE,
          entityId: id,
          companyId,
          userId: user.id,
          changes: diffChanges(before, updated, EXPENSE_AUDIT_FIELDS),
        },
        manager,
      );
      return updated;
    });

    await this.notifyOwner(user, after, 'paid');
    return this.get(user, id);
  }

  /**
   * Annule une dépense en attente. Un collaborateur annule sa note tant qu'elle n'est pas
   * validée. Une dépense payée ne s'annule pas : l'admin la supprime. Idempotent.
   */
  async cancel(viewer: AuthenticatedUser, id: string) {
    const { companyId } = viewer;
    const privileged = isManagerOrAdmin(viewer);

    const outcome = await this.dataSource.transaction(async (manager) => {
      const repo = this.expenses.withManager(manager);
      const before = await repo.lockById(companyId, id, viewerOf(viewer));

      if (before.status === CANCELLED) return { expense: before, changed: false };
      if (before.status === PAID) {
        throw new ConflictAppException(
          'Une dépense payée ne peut plus être annulée : demandez à un administrateur de la supprimer.',
          ErrorCode.INVALID_STATE,
        );
      }
      if (!privileged && before.validatedAt !== null) {
        throw new AccessDeniedException(
          'Cette note de frais a déjà été validée : seul un manager peut l\'annuler.',
        );
      }

      const after = await repo.changeExpense(companyId, id, { status: CANCELLED });
      await this.audit.record(
        {
          action: AuditAction.CANCEL,
          entityType: AuditEntityType.EXPENSE,
          entityId: id,
          companyId,
          userId: viewer.id,
          changes: diffChanges(before, after, EXPENSE_AUDIT_FIELDS),
        },
        manager,
      );
      return { expense: after, changed: true };
    });

    if (outcome.changed) await this.notifyOwner(viewer, outcome.expense, 'cancelled');
    return this.get(viewer, id);
  }

  /** Suppression définitive (admin) : lignes et justificatif partent avec la dépense. */
  async remove(admin: AuthenticatedUser, id: string): Promise<void> {
    const { companyId } = admin;

    const receiptKey = await this.dataSource.transaction(async (manager) => {
      const repo = this.expenses.withManager(manager);
      const files = this.files.withManager(manager);
      const expense = await repo.lockById(companyId, id, viewerOf(admin));

      const itemsCount = (await repo.itemsFor(companyId, id)).length;
      const receiptId = receiptIdFromUrl(expense.receiptUrl);
      const receipt = receiptId ? await files.findById(companyId, receiptId) : null;

      const before = snapshot(expense, EXPENSE_AUDIT_FIELDS);
      await repo.deleteById(companyId, id); // les lignes partent en cascade
      if (receipt) await files.deleteById(companyId, receipt.id);

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entityType: AuditEntityType.EXPENSE,
          entityId: id,
          companyId,
          userId: admin.id,
          changes: { before: { ...before, items_count: itemsCount } },
        },
        manager,
      );
      return receipt?.fileUrl ?? null;
    });

    if (receiptKey) await this.deleteObject(receiptKey);
  }

  // ---------- Justificatif ----------

  /**
   * Rattache un justificatif (POST /files avec purpose=receipt). Un nouveau justificatif
   * remplace l'ancien. Un justificatif n'appartient qu'à une seule dépense.
   */
  async attachReceipt(viewer: AuthenticatedUser, id: string, fileId: string) {
    const { companyId } = viewer;
    const privileged = isManagerOrAdmin(viewer);

    const obsoleteKey = await this.dataSource.transaction(async (manager) => {
      const repo = this.expenses.withManager(manager);
      const files = this.files.withManager(manager);
      const before = await repo.lockById(companyId, id, viewerOf(viewer)); // 404 si invisible
      this.assertReceiptEditable(before, privileged);

      // Un collaborateur ne rattache que ses propres envois
      const file = await files.findById(companyId, fileId);
      if (
        !file ||
        file.purpose !== MediaPurpose.RECEIPT ||
        (!privileged && file.uploadedById !== viewer.id)
      ) {
        throw new InvalidReferenceException('file_id', 'Justificatif');
      }

      const url = privateFilePath(file.id);
      if (before.receiptUrl === url) return null; // déjà rattaché : rien à faire

      if (await files.expenseOfReceipt(companyId, url)) {
        throw new ConflictAppException(
          'Ce justificatif est déjà rattaché à une autre dépense.',
          ErrorCode.INVALID_STATE,
        );
      }

      const previousId = receiptIdFromUrl(before.receiptUrl);
      const previous = previousId ? await files.findById(companyId, previousId) : null;

      const after = await repo.changeExpense(companyId, id, { receiptUrl: url });
      if (previous) await files.deleteById(companyId, previous.id);

      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.EXPENSE,
          entityId: id,
          companyId,
          userId: viewer.id,
          changes: diffChanges(before, after, EXPENSE_AUDIT_FIELDS),
        },
        manager,
      );
      return previous?.fileUrl ?? null;
    });

    if (obsoleteKey) await this.deleteObject(obsoleteKey);
    return this.get(viewer, id);
  }

  /** Retire le justificatif et supprime son fichier. Idempotent. */
  async detachReceipt(viewer: AuthenticatedUser, id: string): Promise<void> {
    const { companyId } = viewer;
    const privileged = isManagerOrAdmin(viewer);

    const obsoleteKey = await this.dataSource.transaction(async (manager) => {
      const repo = this.expenses.withManager(manager);
      const files = this.files.withManager(manager);
      const before = await repo.lockById(companyId, id, viewerOf(viewer));
      if (before.receiptUrl === null) return null;
      this.assertReceiptEditable(before, privileged);

      const receiptId = receiptIdFromUrl(before.receiptUrl);
      const receipt = receiptId ? await files.findById(companyId, receiptId) : null;

      const after = await repo.changeExpense(companyId, id, { receiptUrl: null });
      if (receipt) await files.deleteById(companyId, receipt.id);

      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.EXPENSE,
          entityId: id,
          companyId,
          userId: viewer.id,
          changes: diffChanges(before, after, EXPENSE_AUDIT_FIELDS),
        },
        manager,
      );
      return receipt?.fileUrl ?? null;
    });

    if (obsoleteKey) await this.deleteObject(obsoleteKey);
  }

  // ---------- Outils internes ----------

  private async context(companyId: string) {
    const company = await this.companies.getById(companyId);
    return { company, today: todayIn(company.timezone) };
  }

  private assertCollaboratorFields(dto: object, userId: string): void {
    const source = dto as Record<string, unknown>;
    const forbidden = COLLABORATOR_FORBIDDEN.filter(
      (field) => source[field] !== undefined && !(field === 'user_id' && source[field] === userId),
    );
    if (forbidden.length > 0) {
      throw new AccessDeniedException(
        `Un collaborateur ne peut pas renseigner : ${forbidden.join(', ')}.`,
      );
    }
  }

  private assertEditable(before: Expense, dto: UpdateExpenseDto, privileged: boolean): void {
    if (before.status === CANCELLED) {
      throw new BusinessRuleException(
        "Une dépense annulée n'est plus modifiable.",
        ErrorCode.EXPENSE_LOCKED,
      );
    }
    if (!privileged) {
      if (before.status !== PENDING || before.validatedAt !== null) {
        throw new BusinessRuleException(
          "Cette note de frais a déjà été traitée (validée ou payée) : elle n'est plus modifiable.",
          ErrorCode.EXPENSE_LOCKED,
        );
      }
      return;
    }
    if (before.status === PAID) {
      const touched = Object.entries(dto)
        .filter(([key, value]) => value !== undefined && !PAID_EDITABLE.includes(key))
        .map(([key]) => key);
      if (touched.length > 0) {
        throw new BusinessRuleException(
          `Cette dépense est payée : ${touched.join(', ')} ne peuvent plus être modifiés (seuls ${PAID_EDITABLE.join(', ')} le restent).`,
          ErrorCode.EXPENSE_LOCKED,
        );
      }
    }
  }

  private assertReceiptEditable(expense: Expense, privileged: boolean): void {
    if (expense.status === CANCELLED) {
      throw new BusinessRuleException(
        "Une dépense annulée n'est plus modifiable.",
        ErrorCode.EXPENSE_LOCKED,
      );
    }
    if (!privileged && (expense.status !== PENDING || expense.validatedAt !== null)) {
      throw new BusinessRuleException(
        "Cette note de frais a déjà été traitée : son justificatif n'est plus modifiable.",
        ErrorCode.EXPENSE_LOCKED,
      );
    }
  }

  /** Catégorie et projet actifs de l'entreprise ; un collaborateur : projet auquel il participe. */
  private async assertReferences(
    manager: EntityManager,
    user: AuthenticatedUser,
    privileged: boolean,
    refs: { categoryId?: string | null; projectId?: string | null; userId?: string | null },
  ): Promise<void> {
    const { companyId } = user;

    if (refs.categoryId) {
      await this.categories
        .withManager(manager)
        .assertReference(companyId, refs.categoryId, 'category_id');
    }
    if (refs.projectId) {
      const projects = this.projects.withManager(manager);
      await projects.assertReference(companyId, refs.projectId, 'project_id');
      if (!privileged && !(await projects.isParticipant(companyId, refs.projectId, user.id))) {
        throw new InvalidReferenceException('project_id', 'Projet');
      }
    }
    if (refs.userId) {
      await this.expenses.withManager(manager).assertActiveUser(companyId, refs.userId, 'user_id');
    }
  }

  private async loadReceipt(
    companyId: string,
    receiptUrl: string | null,
  ): Promise<ReceiptInfo | null> {
    const fileId = receiptIdFromUrl(receiptUrl);
    if (!fileId) return null;

    const file = await this.files.findById(companyId, fileId);
    if (!file) return null;
    return {
      id: file.id,
      file_name: file.fileName,
      file_type: file.fileType,
      file_size: file.fileSize,
      url: privateFilePath(file.id),
    };
  }

  /** Le propriétaire est prévenu d'une décision prise par quelqu'un d'autre. */
  private notifyOwner(
    actor: AuthenticatedUser,
    expense: Pick<Expense, 'id' | 'title' | 'userId'>,
    decision: 'validated' | 'paid' | 'cancelled',
  ): Promise<void> {
    return this.notifications.notify({
      companyId: actor.companyId,
      recipientIds: expense.userId ? [expense.userId] : [],
      actorId: actor.id,
      ...notificationTemplates.expenseDecided({ id: expense.id, title: expense.title }, decision),
    });
  }

  private async deleteObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.error(`Suppression de l'objet de stockage impossible : ${key}`, error as Error);
    }
  }
}