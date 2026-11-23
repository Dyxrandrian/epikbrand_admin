const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2000, 0, 1);

/** Jours décomptés (0 = dimanche … 6 = samedi). Par défaut : du lundi au vendredi. */
export const WORKING_WEEKDAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

/**
 * Jours fériés (AAAA-MM-JJ) non décomptés. Vide pour l'instant : à alimenter, ou à remplacer par
 * une table propre à l'entreprise (voir « À savoir »).
 */
export const PUBLIC_HOLIDAYS: ReadonlySet<string> = new Set<string>();

const toTime = (iso: string): number => {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const toIso = (time: number): string => new Date(time).toISOString().slice(0, 10);

export const addDays = (iso: string, days: number): string => toIso(toTime(iso) + days * DAY_MS);

/** Nombre de jours depuis le 2000-01-01 (même origine que la base). */
export const dayOrdinal = (iso: string): number => Math.round((toTime(iso) - EPOCH) / DAY_MS);

export const spanDays = (start: string, end: string): number =>
  dayOrdinal(end) - dayOrdinal(start) + 1;

export const isWorkingDay = (iso: string): boolean =>
  WORKING_WEEKDAYS.has(new Date(toTime(iso)).getUTCDay()) && !PUBLIC_HOLIDAYS.has(iso);

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let n = spanDays(from, to), i = 0; i < n; i++) days.push(addDays(from, i));
  return days;
}

/**
 * Créneaux (demi-journées) : le matin d'un jour vaut 2n, l'après-midi 2n + 1.
 * Deux demandes se chevauchent si leurs intervalles [début, fin] se recoupent.
 */
export const slotStart = (startDate: string, startHalfDay: boolean): number =>
  dayOrdinal(startDate) * 2 + (startHalfDay ? 1 : 0);
export const slotEnd = (endDate: string, endHalfDay: boolean): number =>
  dayOrdinal(endDate) * 2 + (endHalfDay ? 0 : 1);

export interface LeaveSpan {
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
}

/** Décompte en demi-journées, par année civile. */
export function leaveHalfDaysByYear(span: LeaveSpan): Map<number, number> {
  const byYear = new Map<number, number>();
  const count = spanDays(span.startDate, span.endDate);

  for (let i = 0; i < count; i++) {
    const date = addDays(span.startDate, i);
    if (!isWorkingDay(date)) continue;

    let halves = 2;
    if (i === 0 && span.startHalfDay) halves -= 1;
    if (i === count - 1 && span.endHalfDay) halves -= 1;
    if (halves <= 0) continue;

    const year = Number(date.slice(0, 4));
    byYear.set(year, (byYear.get(year) ?? 0) + halves);
  }
  return byYear;
}

export const sumHalves = (byYear: ReadonlyMap<number, number>): number =>
  [...byYear.values()].reduce((sum, halves) => sum + halves, 0);