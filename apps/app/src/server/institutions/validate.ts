/**
 * Strict request-body validation for the Plaid routes. Unknown keys are
 * rejected so a client cannot smuggle extra fields through.
 */
export type ExchangeBody = { publicToken: string; institutionName: string | null };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function onlyKeys(obj: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(obj).every((k) => allowed.includes(k));
}

export function parseExchangeBody(body: unknown): ExchangeBody | null {
  if (!isPlainObject(body) || !onlyKeys(body, ["public_token", "institution"])) return null;
  const token = body.public_token;
  if (typeof token !== "string" || token.length < 10 || token.length > 300 || /\s/.test(token)) {
    return null;
  }
  let institutionName: string | null = null;
  if (body.institution !== undefined && body.institution !== null) {
    const inst = body.institution;
    if (!isPlainObject(inst) || !onlyKeys(inst, ["name", "institution_id"])) return null;
    if (inst.name !== undefined && inst.name !== null) {
      if (typeof inst.name !== "string" || inst.name.length > 200) return null;
      institutionName = inst.name;
    }
    if (
      inst.institution_id !== undefined &&
      inst.institution_id !== null &&
      (typeof inst.institution_id !== "string" || inst.institution_id.length > 100)
    ) {
      return null;
    }
  }
  return { publicToken: token, institutionName };
}

/** For routes that take no body: accept an absent or empty body, reject anything else. */
export function isEmptyBody(text: string): boolean {
  if (text.trim() === "") return true;
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) && Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}
