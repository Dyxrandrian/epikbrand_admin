import type { TransformFnParams } from 'class-transformer';
import { registerDecorator } from 'class-validator';

// Noms IANA uniquement (Indian/Antananarivo, UTC…), pas de décalages du type "+03:00"
const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

function resolveTimeZone(value: string): string | null {
  if (value.length > 50 || !TIME_ZONE_PATTERN.test(value)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** "indian/antananarivo" devient "Indian/Antananarivo" ; une valeur invalide reste inchangée. */
export const canonicalTimeZone = ({ value }: TransformFnParams) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return resolveTimeZone(trimmed) ?? trimmed;
};

export function IsTimeZone() {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName,
      options: {
        message: 'Le fuseau horaire est invalide (exemple : Indian/Antananarivo).',
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && resolveTimeZone(value) !== null,
      },
    });
}