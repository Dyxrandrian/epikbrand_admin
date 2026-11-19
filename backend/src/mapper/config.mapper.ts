import type { ArticleCategory } from '../entities/article-category.entity.js';
import type { ArticleSection } from '../entities/article-section.entity.js';
import type { ExpenseCategory } from '../entities/expense-category.entity.js';
import type { Label } from '../entities/label.entity.js';
import type { LeaveType } from '../entities/leave-type.entity.js';
import type { StructureElementType } from '../entities/structure-element-type.entity.js';

export const toLeaveType = (item: LeaveType) => ({
  id: item.id,
  name: item.name,
  default_annual_days: item.defaultAnnualDays,
});

export const toArticleCategory = (item: ArticleCategory) => ({
  id: item.id,
  name: item.name,
  slug: item.slug,
});

export const toArticleSection = (item: ArticleSection) => ({
  id: item.id,
  name: item.name,
  slug: item.slug,
});

export const toStructureElementType = (item: StructureElementType) => ({
  id: item.id,
  name: item.name,
  slug: item.slug,
});

export const toExpenseCategory = (item: ExpenseCategory) => ({
  id: item.id,
  name: item.name,
  description: item.description,
});

export const toLabel = (item: Label) => ({
  id: item.id,
  name: item.name,
  color: item.color,
});