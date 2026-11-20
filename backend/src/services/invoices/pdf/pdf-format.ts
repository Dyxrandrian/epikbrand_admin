/** Caractères de la table WinAnsi hors Latin-1 (€, guillemets typographiques, tirets, œ…). */
const WIN_ANSI_EXTRAS = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

/**
 * Texte sûr pour pdfkit : sans caractères de contrôle ni de renversement ; avec les polices
 * standard, tout caractère hors table WinAnsi devient « ? » au lieu d'un symbole illisible.
 */
export function pdfSafe(value: string | null | undefined, unicodeFont: boolean): string {
  if (!value) return '';
  const cleaned = value
    .normalize('NFC')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '');

  let out = '';
  for (const char of cleaned) {
    const code = char.codePointAt(0) as number;
    if (code === 0x0a) {
      out += '\n';
      continue;
    }
    if (code === 0x09) {
      out += ' ';
      continue;
    }
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    const printable =
      unicodeFont || code <= 0x7e || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(code);
    out += printable ? char : '?';
  }
  return out.trim();
}

const group = (integer: string): string => integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** 1234567.5 devient « 1 234 567,50 » (espaces ordinaires : les polices standard n'ont pas d'espace fine). */
export function formatNumber(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  const [integer, fraction] = Math.abs(rounded).toFixed(decimals).split('.');
  return `${rounded < 0 ? '-' : ''}${group(integer)}${fraction ? `,${fraction}` : ''}`;
}

export const formatMoney = formatNumber;

/** 2 devient « 2 », 1.5 devient « 1,5 ». */
export function formatQuantity(value: number): string {
  const trimmed = value.toFixed(2).replace(/\.?0+$/, '');
  const [integer, fraction] = trimmed.split('.');
  return `${group(integer)}${fraction ? `,${fraction}` : ''}`;
}

/** 0.2 devient « 20 % », 0.055 devient « 5,5 % ». */
export function formatPercent(rate: number): string {
  const percent = Math.round(rate * 10_000) / 100;
  return `${String(percent).replace('.', ',')} %`;
}

/** AAAA-MM-JJ devient JJ/MM/AAAA, sans passer par un fuseau. */
export function formatDate(iso: string | null | undefined): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** Sans décimales si tous les montants du document sont entiers (cas courant en Ariary). */
export function moneyDecimals(values: ReadonlyArray<number | null | undefined>): 0 | 2 {
  return values.every((value) => value == null || Math.round(value * 100) % 100 === 0) ? 0 : 2;
}