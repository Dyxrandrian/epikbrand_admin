import type { TransformFnParams } from 'class-transformer';

export const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;

export const normalizeEmail = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const trimToNull = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() || null : value;

export const toBoolean = ({ value }: TransformFnParams) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Retire les espaces en début, en fin, et réduit les espaces multiples. */
export const normalizeName = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export const upperCaseTrim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** E-mail facultatif : en minuscules, une chaîne vide devient null. */
export const normalizeOptionalEmail = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;

/** Champ de formulaire laissé vide : traité comme absent. */
export const emptyToUndefined = ({ value }: TransformFnParams) =>
  value === '' ? undefined : value;