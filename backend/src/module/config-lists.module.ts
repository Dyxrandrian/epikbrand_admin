import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ArticleCategoriesController,
  ArticleSectionsController,
  ExpenseCategoriesController,
  LabelsController,
  LeaveTypesController,
  StructureElementTypesController,
} from '../controller/config/config-lists.controllers.js';
import { ArticleCategory } from '../entities/article-category.entity.js';
import { ArticleSection } from '../entities/article-section.entity.js';
import { ExpenseCategory } from '../entities/expense-category.entity.js';
import { Label } from '../entities/label.entity.js';
import { LeaveType } from '../entities/leave-type.entity.js';
import { StructureElementType } from '../entities/structure-element-type.entity.js';
import {
  ArticleCategoryRepository,
  ArticleSectionRepository,
  ExpenseCategoryRepository,
  LabelRepository,
  LeaveTypeRepository,
  StructureElementTypeRepository,
} from '../repository/config-lists.repositories.js';
import {
  ArticleCategoryService,
  ArticleSectionService,
  ExpenseCategoryService,
  LabelService,
  LeaveTypeService,
  StructureElementTypeService,
} from '../services/config/config-lists.services.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeaveType,
      ArticleCategory,
      ArticleSection,
      StructureElementType,
      ExpenseCategory,
      Label,
    ]),
  ],
  controllers: [
    LeaveTypesController,
    ArticleCategoriesController,
    ArticleSectionsController,
    StructureElementTypesController,
    ExpenseCategoriesController,
    LabelsController,
  ],
  providers: [
    LeaveTypeRepository,
    ArticleCategoryRepository,
    ArticleSectionRepository,
    StructureElementTypeRepository,
    ExpenseCategoryRepository,
    LabelRepository,
    LeaveTypeService,
    ArticleCategoryService,
    ArticleSectionService,
    StructureElementTypeService,
    ExpenseCategoryService,
    LabelService,
  ],
})
export class ConfigListsModule {}