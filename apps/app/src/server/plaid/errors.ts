/**
 * Plaid failures normalised to a small typed error. The message is chosen by
 * us from the error code, never copied from the response, so no response
 * content (which can name institutions or accounts) reaches a log or a client.
 */
const MESSAGES: Record<string, string> = {
  ITEM_LOGIN_REQUIRED: "The institution needs you to sign in again.",
  ITEM_NOT_FOUND: "Plaid no longer has this connection.",
  INVALID_PUBLIC_TOKEN: "The link session is invalid or expired. Try linking again.",
  RATE_LIMIT: "Plaid is rate limiting requests. Try again shortly.",
  NETWORK: "Could not reach Plaid.",
  INVALID_FIELD_REDIRECT_URI:
    "Plaid rejected the OAuth redirect address. Add it in the Plaid Dashboard under Allowed redirect URIs, or clear PLAID_REDIRECT_URI.",
  INVALID_FIELD_WEBHOOK:
    "Plaid rejected the webhook address. It must be a public https URL ending in /api/webhooks/plaid.",
  INVALID_FIELD: "Plaid rejected one of the link settings.",
  INVALID_API_KEYS:
    "Plaid rejected the API keys. Check that PLAID_CLIENT_ID, PLAID_SECRET and PLAID_ENV belong together.",
  INVALID_PRODUCT: "Plaid has not enabled one of the requested products for this account.",
  INVALID_LINK_CUSTOMIZATION:
    "Plaid's Link customization has no use case. In the Plaid Dashboard, open Customize > Link, choose the default customization, select a use case under Data Transparency, and publish the changes.",
};

/**
 * INVALID_FIELD covers several fields. To say which one without keeping
 * Plaid's text, the message is scanned for a field name and only the derived
 * code survives; the text itself is dropped here.
 */
function refineCode(code: string | null, message: string | null): string | null {
  if (code !== "INVALID_FIELD" || !message) return code;
  if (/redirect/i.test(message)) return "INVALID_FIELD_REDIRECT_URI";
  if (/webhook/i.test(message)) return "INVALID_FIELD_WEBHOOK";
  return code;
}

export function safeMessageFor(code: string): string {
  return MESSAGES[code] ?? "Plaid could not complete the request.";
}

export class PlaidApiError extends Error {
  readonly code: string;
  readonly type: string | null;
  readonly status: number | null;

  constructor(code: string, status: number | null = null, type: string | null = null) {
    super(safeMessageFor(code));
    this.name = "PlaidApiError";
    this.code = code;
    this.status = status;
    this.type = type;
  }

  get isLoginRequired(): boolean {
    return this.code === "ITEM_LOGIN_REQUIRED";
  }
}

export class PlaidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaidConfigError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * Accepts whatever the SDK throws (an Axios error whose `response.data` is
 * Plaid's error body) and returns a PlaidApiError. Only the code, type and
 * HTTP status are read; the body is never retained.
 */
export function normalisePlaidError(err: unknown): PlaidApiError {
  if (err instanceof PlaidApiError) return err;
  if (isRecord(err) && isRecord(err.response)) {
    const status = typeof err.response.status === "number" ? err.response.status : null;
    const data = err.response.data;
    const code = refineCode(
      isRecord(data) ? str(data.error_code) : null,
      isRecord(data) ? str(data.error_message) : null,
    );
    const type = isRecord(data) ? str(data.error_type) : null;
    return new PlaidApiError(code ?? (status === 429 ? "RATE_LIMIT" : "UNKNOWN"), status, type);
  }
  if (isRecord(err) && typeof err.code === "string" && /^E[A-Z]+$/.test(err.code)) {
    return new PlaidApiError("NETWORK");
  }
  return new PlaidApiError("UNKNOWN");
}
