const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    };
    try {
      formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone });
    } catch {
      formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }); // fuseau inconnu : UTC
    }
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Date (AAAA-MM-JJ) et heure (HH:MM) locales dans un fuseau IANA. */
export function localClock(timeZone: string, now: Date): { date: string; time: string } {
  const parts = formatterFor(timeZone).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}