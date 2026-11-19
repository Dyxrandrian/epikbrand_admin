export function mapDto(
  dto: object,
  map: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const source = dto as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  for (const [dtoField, property] of Object.entries(map)) {
    if (source[dtoField] !== undefined) changes[property] = source[dtoField];
  }
  return changes;
}