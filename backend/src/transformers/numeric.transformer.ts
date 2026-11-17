import type { ValueTransformer } from 'typeorm';

/**
 * pg renvoie NUMERIC et BIGINT sous forme de string.
 * Ces transformers les convertissent en number côté TypeScript.
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null => (value === null || value === undefined ? null : parseFloat(value)),
};

export const bigintTransformer: ValueTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null => (value === null || value === undefined ? null : Number(value)),
};
