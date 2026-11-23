export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** « 2026-05 » devient « mai 2026 ». */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return `${MONTHS[index - 1]} ${year}`;
}

/** Premier jour du mois (AAAA-MM-JJ). */
export const monthStart = (month: string): string => `${month}-01`;

export function addMonths(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number);
  const total = year * 12 + (index - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Tous les mois de `from` à `to` inclus (comparaison de chaînes AAAA-MM). */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
}