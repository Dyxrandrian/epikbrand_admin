import type { ExpenseItem } from '../entities/expense-item.entity.js';
import type { Expense } from '../entities/expense.entity.js';
import { ExpenseStatus } from '../enums/app.enums.js';
import { lineTotal } from '../services/expenses/expense-amounts.js';

export interface ReceiptInfo {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  url: string;
}

/** `category`, `project` et `user` n'apparaissent que si la relation a été chargée. */
export function toExpense(expense: Expense, today: string) {
  const pending = expense.status === ExpenseStatus.PENDING;
  return {
    id: expense.id,
    title: expense.title,
    supplier_name: expense.supplierName,
    category_id: expense.categoryId,
    project_id: expense.projectId,
    user_id: expense.userId,
    amount_ht: expense.amountHt,
    vat_amount: expense.vatAmount,
    amount_ttc: expense.amountTtc,
    status: expense.status,
    awaiting_validation: pending && expense.validatedAt === null,
    is_recurring: expense.isRecurring,
    recurrence: expense.recurrence,
    parent_expense_id: expense.parentExpenseId,
    expense_date: expense.expenseDate,
    due_date: expense.dueDate,
    is_overdue: pending && expense.dueDate !== null && expense.dueDate < today,
    paid_at: expense.paidAt,
    payment_method: expense.paymentMethod,
    has_receipt: expense.receiptUrl !== null,
    receipt_url: expense.receiptUrl,
    validated_at: expense.validatedAt,
    validated_by: expense.validatedById,
    ...(expense.category !== undefined
      ? {
          category: expense.category
            ? { id: expense.category.id, name: expense.category.name }
            : null,
        }
      : {}),
    ...(expense.project !== undefined
      ? {
          project: expense.project
            ? { id: expense.project.id, title: expense.project.title }
            : null,
        }
      : {}),
    ...(expense.user !== undefined
      ? {
          user: expense.user
            ? {
                id: expense.user.id,
                name: expense.user.name,
                avatar_url: expense.user.avatarUrl,
              }
            : null,
        }
      : {}),
    created_at: expense.createdAt,
    updated_at: expense.updatedAt,
  };
}

export function toExpenseItem(item: ExpenseItem) {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    line_total: lineTotal(item.quantity, item.unitPrice),
  };
}

export function toExpenseDetail(
  expense: Expense,
  context: { today: string; items: ExpenseItem[]; receipt: ReceiptInfo | null },
) {
  return {
    ...toExpense(expense, context.today),
    items: context.items.map(toExpenseItem),
    receipt: context.receipt,
  };
}