import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArticleCategory } from '../entities/article-category.entity.js';
import { ArticleSection } from '../entities/article-section.entity.js';
import { ExpenseCategory } from '../entities/expense-category.entity.js';
import { Label } from '../entities/label.entity.js';
import { LeaveType } from '../entities/leave-type.entity.js';
import { StructureElementType } from '../entities/structure-element-type.entity.js';
import {
  ConfigItemRepository,
  SluggableConfigItemRepository,
} from './config-item.repository.js';

@Injectable()
export class LeaveTypeRepository extends ConfigItemRepository<LeaveType> {
  protected readonly alias = 'lt';
  protected readonly label = 'Type de congé';

  constructor(@InjectRepository(LeaveType) repo: Repository<LeaveType>) {
    super(repo);
  }

  // Pas de réaffectation : le contrat veut un 409 tant que des demandes l'utilisent
  countUsage(companyId: string, id: string): Promise<number> {
    return this.countRows(
      'SELECT COUNT(*)::int AS n FROM leave_requests WHERE company_id = $1 AND leave_type_id = $2',
      [companyId, id],
    );
  }
}

@Injectable()
export class ArticleCategoryRepository extends SluggableConfigItemRepository<ArticleCategory> {
  protected readonly alias = 'acat';
  protected readonly label = "Catégorie d'article";

  constructor(@InjectRepository(ArticleCategory) repo: Repository<ArticleCategory>) {
    super(repo);
  }

  countUsage(companyId: string, id: string): Promise<number> {
    return this.countRows(
      'SELECT COUNT(*)::int AS n FROM agency_articles WHERE company_id = $1 AND category_id = $2',
      [companyId, id],
    );
  }

  // version + 1 : un éditeur qui a chargé l'article avant le déplacement recevra un 409
  override async reassignUsage(companyId: string, fromId: string, toId: string): Promise<void> {
    await this.repo.manager.query(
      `UPDATE agency_articles
          SET category_id = $3, version = version + 1, updated_at = now()
        WHERE company_id = $1 AND category_id = $2`,
      [companyId, fromId, toId],
    );
  }
}

@Injectable()
export class ArticleSectionRepository extends SluggableConfigItemRepository<ArticleSection> {
  protected readonly alias = 'asec';
  protected readonly label = "Section d'article";

  constructor(@InjectRepository(ArticleSection) repo: Repository<ArticleSection>) {
    super(repo);
  }

  countUsage(companyId: string, id: string): Promise<number> {
    return this.countRows(
      'SELECT COUNT(*)::int AS n FROM agency_articles WHERE company_id = $1 AND section_id = $2',
      [companyId, id],
    );
  }

  override async reassignUsage(companyId: string, fromId: string, toId: string): Promise<void> {
    await this.repo.manager.query(
      `UPDATE agency_articles
          SET section_id = $3, version = version + 1, updated_at = now()
        WHERE company_id = $1 AND section_id = $2`,
      [companyId, fromId, toId],
    );
  }
}

@Injectable()
export class StructureElementTypeRepository extends SluggableConfigItemRepository<StructureElementType> {
  protected readonly alias = 'stype';
  protected readonly label = "Type d'élément de structure";

  constructor(@InjectRepository(StructureElementType) repo: Repository<StructureElementType>) {
    super(repo);
  }

  // Ici la base ferait un CASCADE : sans cette vérification, les éléments seraient effacés
  countUsage(companyId: string, id: string): Promise<number> {
    return this.countRows(
      'SELECT COUNT(*)::int AS n FROM agency_structure WHERE company_id = $1 AND type_id = $2',
      [companyId, id],
    );
  }

  override async reassignUsage(companyId: string, fromId: string, toId: string): Promise<void> {
    await this.repo.manager.query(
      `UPDATE agency_structure SET type_id = $3, updated_at = now()
        WHERE company_id = $1 AND type_id = $2`,
      [companyId, fromId, toId],
    );
  }
}

@Injectable()
export class ExpenseCategoryRepository extends ConfigItemRepository<ExpenseCategory> {
  protected readonly alias = 'ecat';
  protected readonly label = 'Catégorie de dépenses';

  constructor(@InjectRepository(ExpenseCategory) repo: Repository<ExpenseCategory>) {
    super(repo);
  }

  countUsage(companyId: string, id: string): Promise<number> {
    return this.countRows(
      'SELECT COUNT(*)::int AS n FROM expenses WHERE company_id = $1 AND category_id = $2',
      [companyId, id],
    );
  }

  override async reassignUsage(companyId: string, fromId: string, toId: string): Promise<void> {
    await this.repo.manager.query(
      `UPDATE expenses SET category_id = $3, updated_at = now()
        WHERE company_id = $1 AND category_id = $2`,
      [companyId, fromId, toId],
    );
  }
}

@Injectable()
export class LabelRepository extends ConfigItemRepository<Label> {
  protected readonly alias = 'lbl';
  protected readonly label = 'Étiquette';

  constructor(@InjectRepository(Label) repo: Repository<Label>) {
    super(repo);
  }

  // task_labels n'a pas de company_id : on passe par la tâche pour rester dans l'entreprise
  countUsage(companyId: string, id: string): Promise<number> {
    return this.countRows(
      `SELECT COUNT(*)::int AS n
         FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
        WHERE t.company_id = $1 AND tl.label_id = $2`,
      [companyId, id],
    );
  }

  // Une tâche qui porte déjà la nouvelle étiquette ne la reçoit pas deux fois (ON CONFLICT).
  // Les anciennes lignes disparaissent avec l'étiquette (CASCADE) au moment de la suppression.
  override async reassignUsage(companyId: string, fromId: string, toId: string): Promise<void> {
    await this.repo.manager.query(
      `INSERT INTO task_labels (task_id, label_id)
       SELECT tl.task_id, $3::uuid
         FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
        WHERE t.company_id = $1 AND tl.label_id = $2
       ON CONFLICT DO NOTHING`,
      [companyId, fromId, toId],
    );
  }
}