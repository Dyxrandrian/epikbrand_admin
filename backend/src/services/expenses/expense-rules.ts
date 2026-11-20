import type { ExpenseItemDto } from '../../dto/expenses/expense-item.dto.js';
import type { ExpenseRecurrence } from '../../enums/app.enums.js';
import { BusinessRuleException, ValidationFailedException } from '../../exceptions/index.js';

export interface ExpenseItemRow {
  position: number;
  description: string;
  quantity: number;
  unitPrice: number;
}

export const toItemRows = (items: readonly ExpenseItemDto[]): ExpenseItemRow[] =>
  items.map((item, index) => ({
    position: index,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unit_price,
  }));

export function assertDueDate(expenseDate: string, dueDate: string | null): void {
  if (dueDate !== null && dueDate < expenseDate) {
    throw new BusinessRuleException("L'échéance ne peut pas précéder la date de la dépense.");
  }
}

/**
 * Récurrence finale d'une dépense. `recurrence` seul vaut « récurrente » ; `is_recurring: false`
 * efface la périodicité. Une occurrence générée ne peut pas devenir un modèle.
 */
export function resolveRecurrence(
  input: { isRecurring?: boolean; recurrence?: ExpenseRecurrence | null },
  current: {
    isRecurring: boolean;
    recurrence: ExpenseRecurrence | null;
    parentExpenseId: string | null;
  },
): { isRecurring: boolean; recurrence: ExpenseRecurrence | null } {
  let isRecurring = input.isRecurring ?? current.isRecurring;
  const recurrence = input.recurrence !== undefined ? input.recurrence : current.recurrence;

  if (input.isRecurring === undefined && input.recurrence) isRecurring = true;

  if (!isRecurring) {
    if (input.recurrence) {
      throw new ValidationFailedException([
        {
          field: 'recurrence',
          reason: 'recurrenceWithoutFlag',
          message: 'recurrence exige is_recurring=true.',
        },
      ]);
    }
    return { isRecurring: false, recurrence: null };
  }

  if (recurrence === null) {
    throw new ValidationFailedException([
      {
        field: 'recurrence',
        reason: 'recurrenceRequired',
        message: 'La périodicité est obligatoire pour une dépense récurrente.',
      },
    ]);
  }
  if (current.parentExpenseId !== null) {
    throw new BusinessRuleException(
      'Une occurrence générée automatiquement ne peut pas devenir elle-même un modèle de récurrence.',
    );
  }
  return { isRecurring: true, recurrence };
}