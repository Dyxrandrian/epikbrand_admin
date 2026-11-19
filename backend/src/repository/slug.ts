const MAX_BASE_LENGTH = 90; // laisse de la place au suffixe (-2, -3…) dans les 100 caractères de la colonne

/** "Procédures & outils" devient "procedures-outils". */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'element';
}

/** Premier slug libre : base, base-2, base-3… */
export function uniqueSlug(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}