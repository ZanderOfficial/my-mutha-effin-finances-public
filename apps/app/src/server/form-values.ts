// Narrows form values, which arrive as unknown, before any write uses them.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** An optional id: null when empty or missing, undefined when malformed. */
export function parseOptionalId(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  return isUuid(value) ? value : undefined;
}

/** A list of ids, de-duplicated, or undefined when any one is malformed. */
export function parseIdList(values: unknown[]): string[] | undefined {
  const ids = [...new Set(values)];
  return ids.every(isUuid) ? ids : undefined;
}

/** Trimmed text of 1 to `max` characters, or null. */
export function parseName(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= max ? name : null;
}
