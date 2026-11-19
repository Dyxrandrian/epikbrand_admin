import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  CreateExpenseCategoryDto,
  CreateLabelDto,
  CreateLeaveTypeDto,
  CreateNamedItemDto,
  UpdateExpenseCategoryDto,
  UpdateLabelDto,
  UpdateLeaveTypeDto,
  UpdateNamedItemDto,
} from '../../dto/config/index.js';
import type { ArticleCategory } from '../../entities/article-category.entity.js';
import type { ArticleSection } from '../../entities/article-section.entity.js';
import type { ExpenseCategory } from '../../entities/expense-category.entity.js';
import type { Label } from '../../entities/label.entity.js';
import type { LeaveType } from '../../entities/leave-type.entity.js';
import type { StructureElementType } from '../../entities/structure-element-type.entity.js';
import { AuditEntityType } from '../../enums/audit.enums.js';
import {
  toArticleCategory,
  toArticleSection,
  toExpenseCategory,
  toLabel,
  toLeaveType,
  toStructureElementType,
} from '../../mapper/config.mapper.js';
import {
  ArticleCategoryRepository,
  ArticleSectionRepository,
  ExpenseCategoryRepository,
  LabelRepository,
  LeaveTypeRepository,
  StructureElementTypeRepository,
} from '../../repository/config-lists.repositories.js';
import {
  ARTICLE_CATEGORY_AUDIT_FIELDS,
  ARTICLE_SECTION_AUDIT_FIELDS,
  EXPENSE_CATEGORY_AUDIT_FIELDS,
  LABEL_AUDIT_FIELDS,
  LEAVE_TYPE_AUDIT_FIELDS,
  STRUCTURE_ELEMENT_TYPE_AUDIT_FIELDS,
} from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { ConfigItemService, SluggableConfigItemService } from './config-item.service.js';

@Injectable()
export class LeaveTypeService extends ConfigItemService<
  LeaveType,
  CreateLeaveTypeDto,
  UpdateLeaveTypeDto
> {
  protected readonly entityType = AuditEntityType.LEAVE_TYPE;
  protected readonly auditFields = LEAVE_TYPE_AUDIT_FIELDS;
  protected readonly updateMap = {
    name: 'name',
    default_annual_days: 'defaultAnnualDays',
  };

  constructor(dataSource: DataSource, audit: AuditService, repository: LeaveTypeRepository) {
    super(dataSource, audit, repository);
  }

  protected present(item: LeaveType) {
    return toLeaveType(item);
  }

  protected buildCreateData(dto: CreateLeaveTypeDto) {
    return { name: dto.name, defaultAnnualDays: dto.default_annual_days ?? null };
  }

  protected inUseMessage(count: number) {
    return `Ce type de congé est utilisé par ${count} demande(s) : il ne peut pas être supprimé.`;
  }
}

@Injectable()
export class ArticleCategoryService extends SluggableConfigItemService<
  ArticleCategory,
  CreateNamedItemDto,
  UpdateNamedItemDto
> {
  protected readonly entityType = AuditEntityType.ARTICLE_CATEGORY;
  protected readonly auditFields = ARTICLE_CATEGORY_AUDIT_FIELDS;
  protected readonly updateMap = { name: 'name' };

  constructor(dataSource: DataSource, audit: AuditService, repository: ArticleCategoryRepository) {
    super(dataSource, audit, repository);
  }

  protected present(item: ArticleCategory) {
    return toArticleCategory(item);
  }

  protected buildCreateData(dto: CreateNamedItemDto) {
    return { name: dto.name };
  }

  protected inUseMessage(count: number) {
    return `Cette catégorie est utilisée par ${count} article(s). Ajoutez ?reassign_to=<id d'une autre catégorie> pour les y déplacer avant la suppression.`;
  }
}

@Injectable()
export class ArticleSectionService extends SluggableConfigItemService<
  ArticleSection,
  CreateNamedItemDto,
  UpdateNamedItemDto
> {
  protected readonly entityType = AuditEntityType.ARTICLE_SECTION;
  protected readonly auditFields = ARTICLE_SECTION_AUDIT_FIELDS;
  protected readonly updateMap = { name: 'name' };

  constructor(dataSource: DataSource, audit: AuditService, repository: ArticleSectionRepository) {
    super(dataSource, audit, repository);
  }

  protected present(item: ArticleSection) {
    return toArticleSection(item);
  }

  protected buildCreateData(dto: CreateNamedItemDto) {
    return { name: dto.name };
  }

  protected inUseMessage(count: number) {
    return `Cette section contient ${count} article(s). Ajoutez ?reassign_to=<id d'une autre section> pour les y déplacer avant la suppression.`;
  }
}

@Injectable()
export class StructureElementTypeService extends SluggableConfigItemService<
  StructureElementType,
  CreateNamedItemDto,
  UpdateNamedItemDto
> {
  protected readonly entityType = AuditEntityType.STRUCTURE_ELEMENT_TYPE;
  protected readonly auditFields = STRUCTURE_ELEMENT_TYPE_AUDIT_FIELDS;
  protected readonly updateMap = { name: 'name' };

  constructor(
    dataSource: DataSource,
    audit: AuditService,
    repository: StructureElementTypeRepository,
  ) {
    super(dataSource, audit, repository);
  }

  protected present(item: StructureElementType) {
    return toStructureElementType(item);
  }

  protected buildCreateData(dto: CreateNamedItemDto) {
    return { name: dto.name };
  }

  protected inUseMessage(count: number) {
    return `Ce type contient ${count} élément(s) de structure. Ajoutez ?reassign_to=<id d'un autre type> pour les y déplacer avant la suppression.`;
  }
}

@Injectable()
export class ExpenseCategoryService extends ConfigItemService<
  ExpenseCategory,
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto
> {
  protected readonly entityType = AuditEntityType.EXPENSE_CATEGORY;
  protected readonly auditFields = EXPENSE_CATEGORY_AUDIT_FIELDS;
  protected readonly updateMap = { name: 'name', description: 'description' };

  constructor(dataSource: DataSource, audit: AuditService, repository: ExpenseCategoryRepository) {
    super(dataSource, audit, repository);
  }

  protected present(item: ExpenseCategory) {
    return toExpenseCategory(item);
  }

  protected buildCreateData(dto: CreateExpenseCategoryDto) {
    return { name: dto.name, description: dto.description ?? null };
  }

  protected inUseMessage(count: number) {
    return `Cette catégorie est utilisée par ${count} dépense(s). Ajoutez ?reassign_to=<id d'une autre catégorie> pour les y déplacer avant la suppression.`;
  }
}

const DEFAULT_LABEL_COLOR = '#6B7280';

@Injectable()
export class LabelService extends ConfigItemService<Label, CreateLabelDto, UpdateLabelDto> {
  protected readonly entityType = AuditEntityType.LABEL;
  protected readonly auditFields = LABEL_AUDIT_FIELDS;
  protected readonly updateMap = { name: 'name', color: 'color' };

  constructor(dataSource: DataSource, audit: AuditService, repository: LabelRepository) {
    super(dataSource, audit, repository);
  }

  protected present(item: Label) {
    return toLabel(item);
  }

  protected buildCreateData(dto: CreateLabelDto) {
    return { name: dto.name, color: dto.color ?? DEFAULT_LABEL_COLOR };
  }

  protected inUseMessage(count: number) {
    return `Cette étiquette est utilisée par ${count} tâche(s). Ajoutez ?reassign_to=<id d'une autre étiquette> pour les y reporter avant la suppression.`;
  }
}