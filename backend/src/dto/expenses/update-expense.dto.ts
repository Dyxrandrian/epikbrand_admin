import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ExpenseRecurrence } from '../../enums/app.enums.js';
import { DateOnlyField, MoneyField, VatRateField } from '../invoices/invoice-fields.js';
import { MAX_EXPENSE_ITEMS } from './create-expense.dto.js';
import { ExpenseItemDto } from './expense-item.dto.js';
import { ExpenseTitle, SupplierName } from './expense-fields.js';

export class UpdateExpenseDto {
  @ValidateIf((o: UpdateExpenseDto) => o.title !== undefined)
  @ExpenseTitle()
  title?: string;

  @ValidateIf((o: UpdateExpenseDto) => o.supplier_name !== undefined)
  @SupplierName()
  supplier_name?: string;

  /** null retire la catégorie. */
  @IsOptional()
  @IsUUID('all', { message: 'category_id doit être un UUID valide.' })
  category_id?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id?: string | null;

  @IsOptional()
  @MoneyField('Le montant HT')
  amount_ht?: number;

  /** Sans vat_amount, vat_rate ni amount_ttc, le montant de TVA existant est conservé. */
  @IsOptional()
  @MoneyField('Le montant de TVA')
  vat_amount?: number | null;

  @IsOptional()
  @VatRateField()
  vat_rate?: number | null;

  @IsOptional()
  @MoneyField('Le montant TTC')
  amount_ttc?: number | null;

  @ValidateIf((o: UpdateExpenseDto) => o.expense_date !== undefined)
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

  @ValidateIf((o: UpdateExpenseDto) => o.items !== undefined)
  @IsArray({ message: 'items doit être une liste.' })
  @ArrayMaxSize(MAX_EXPENSE_ITEMS, {
    message: `Une dépense ne peut pas avoir plus de ${MAX_EXPENSE_ITEMS} lignes.`,
  })
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  items?: ExpenseItemDto[];
}