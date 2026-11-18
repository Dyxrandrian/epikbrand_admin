export type AuditChanges = {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

const SENSITIVE_KEY = /password|token|secret|hash/i;
const MASK = '[masqué]';
const MAX_STRING_LENGTH = 500;

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function present(field: string, value: unknown): unknown {
  return SENSITIVE_KEY.test(field) ? MASK : value;
}

/** Photo des champs listés (création, suppression). */
export function snapshot(source: object, fields: readonly string[]): Record<string, unknown> {
  const record = source as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[toSnakeCase(field)] = present(field, normalize(record[field]));
  }
  return result;
}

/** Différences entre deux états, limitées aux champs listés. Null s'il n'y en a aucune. */
export function diffChanges(
  before: object,
  after: object,
  fields: readonly string[],
): AuditChanges | null {
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};

  for (const field of fields) {
    const x = normalize(previous[field]);
    const y = normalize(next[field]);
    if (JSON.stringify(x) === JSON.stringify(y)) continue;

    const key = toSnakeCase(field);
    beforeOut[key] = present(field, x);
    afterOut[key] = present(field, y);
  }

  return Object.keys(afterOut).length > 0 ? { before: beforeOut, after: afterOut } : null;
}