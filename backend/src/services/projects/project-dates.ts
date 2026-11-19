/** Date du jour (AAAA-MM-JJ) dans un fuseau IANA ; UTC si le fuseau est inconnu. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    // La locale en-CA formate en AAAA-MM-JJ
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

export interface DateRange {
  from: string;
  to: string;
}

/** Semaine du lundi au dimanche contenant `today`. */
export function weekRange(today: string): DateRange {
  const { y, m, d } = parse(today);
  const day = new Date(Date.UTC(y, m - 1, d));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - sinceMonday));
  const sunday = new Date(Date.UTC(y, m - 1, d - sinceMonday + 6));
  return { from: iso(monday), to: iso(sunday) };
}

/** Du premier au dernier jour du mois de `today`. */
export function monthRange(today: string): DateRange {
  const { y, m } = parse(today);
  return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
}