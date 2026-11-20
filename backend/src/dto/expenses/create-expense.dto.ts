import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ExpenseRecurrence } from '../../enums/app.enums.js';
import { DateOnlyField, MoneyField, VatRateField } from '../invoices/invoice-fields.js';
import { ExpenseItemDto } from './expense-item.dto.js';
import { ExpenseTitle, SupplierName } from './expense-fields.js';

export const MAX_EXPENSE_ITEMS = 100;

export class CreateExpenseDto {
  @ExpenseTitle()
  title: string;

  @SupplierName()
  supplier_name: string;

  @IsOptional()
  @IsUUID('all', { message: 'category_id doit être un UUID valide.' })
  category_id?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id?: string | null;

  /** Utilisateur concerné (admin et manager) ; un collaborateur est toujours lui-même. */
  @IsOptional()
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id?: string | null;

  /** Obligatoire sauf si des lignes (items) sont fournies : il en est alors la somme. */
  @IsOptional()
  @MoneyField('Le montant HT')
  amount_ht?: number;

  /** Au choix : vat_amount, vat_rate (0.2 = 20 %) ou amount_ttc. Sans rien : TVA nulle. */
  @IsOptional()
  @MoneyField('Le montant de TVA')
  vat_amount?: number | null;

  @IsOptional()
  @VatRateField()
  vat_rate?: number | null;

  @IsOptional()
  @MoneyField('Le montant TTC')
  amount_ttc?: number | null;

  /** Par défaut : aujourd'hui (fuseau de l'entreprise). */
  @IsOptional()
  @DateOnlyField()
  expense_date?: string;

  @IsOptional()
  @DateOnlyField()
  due_date?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'is_recurring doit valoir true ou false.' })
  is_recurring?: boolean;

  @IsOptional()
  @IsEnum(ExpenseRecurrence, {
    message: `recurrence doit être l'une de : ${Object.values(ExpenseRecurrence).join(', ')}.`,
  })
  recurrence?: ExpenseRecurrence | null;

  @IsOptional()
  @IsArray({ message: 'items doit être une liste.' })
  @ArrayMaxSize(MAX_EXPENSE_ITEMS, {
    message: `Une dépense ne peut pas avoir plus de ${MAX_EXPENSE_ITEMS} lignes.`,
  })
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  items?: ExpenseItemDto[];
}