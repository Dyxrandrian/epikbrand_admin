import { ExpenseRecurrence } from '../enums/app.enums.js';
import { addDays } from '../services/hr/leave-calendar.js';

/** Ajoute des mois en gardant le jour d'origine, ramené à la fin du mois si besoin (31 janvier + 1 mois = 28 février). */
function addMonthsClamped(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/**
 * Date de la k-ième occurrence après `anchor`. Toujours calculée depuis la date du modèle (et non
 * depuis l'occurrence précédente) pour que le jour du mois ne dérive pas.
 */
export function occurrenceDate(anchor: string, recurrence: ExpenseRecurrence, k: number): string {
  switch (recurrence) {
    case ExpenseRecurrence.WEEKLY:
      return addDays(anchor, 7 * k);
    case ExpenseRecurrence.MONTHLY:
      return addMonthsClamped(anchor, k);
    case ExpenseRecurrence.QUARTERLY:
      return addMonthsClamped(anchor, 3 * k);
    case ExpenseRecurrence.YEARLY:
      return addMonthsClamped(anchor, 12 * k);
  }
}