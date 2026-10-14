import { createHash } from "node:crypto";

/**
 * The only place in the app that may call `console`. Server-side logging goes
 * through here so that nothing sensitive can reach Vercel's log stream: the
 * logger accepts a fixed allowlist of fields and drops everything else, and
 * each accepted field is shape-checked so a stray value cannot ride in under a
 * safe name.
 *
 * Accepted fields:
 *  - `event`     a short snake_case name for what happened
 *  - `status`    an HTTP status code
 *  - `code`      an upper-case error code, such as a Plaid `error_code`
 *  - `errorName` the class name of an exception (never its message)
 *  - `itemRef`   a truncated SHA-256 of a Plaid item id (see `itemRef()`)
 *
 * Never accepted, by construction: messages, request or webhook bodies,
 * tokens, account numbers or masks, balances, transaction details, connection
 * strings or any other free text. `src/server/log.test.ts` fails the build if
 * any other file calls `console` directly.
 */
export type LogFields = {
  status?: number;
  code?: string;
  errorName?: string;
  itemRef?: string;
};

const EVENT = /^[a-z][a-z0-9_.]{0,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ERROR_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;
const ITEM_REF = /^[0-9a-f]{12}$/;

/** A stable, non-reversible handle for an item id: 12 hex characters of its SHA-256. */
export function itemRef(itemId: string): string {
  return createHash("sha256").update(itemId, "utf8").digest("hex").slice(0, 12);
}

/** Builds the exact object that is written. Exported for the tests. */
export function sanitize(event: string, fields: LogFields = {}): Record<string, string | number> {
  const out: Record<string, string | number> = {
    event: EVENT.test(event) ? event : "invalid_event_name",
  };
  if (
    typeof fields.status === "number" &&
    Number.isInteger(fields.status) &&
    fields.status >= 100 &&
    fields.status <= 599
  ) {
    out.status = fields.status;
  }
  if (typeof fields.code === "string" && CODE.test(fields.code)) out.code = fields.code;
  if (typeof fields.errorName === "string" && ERROR_NAME.test(fields.errorName)) {
    out.errorName = fields.errorName;
  }
  if (typeof fields.itemRef === "string" && ITEM_REF.test(fields.itemRef)) {
    out.itemRef = fields.itemRef;
  }
  return out;
}

/** Reads only the safe handles off an exception: its class name and a string `code`. Never the message. */
export function describeError(err: unknown): Pick<LogFields, "code" | "errorName"> {
  if (typeof err !== "object" || err === null) return {};
  const named = err as { name?: unknown; code?: unknown };
  const out: Pick<LogFields, "code" | "errorName"> = {};
  if (typeof named.name === "string") out.errorName = named.name;
  if (typeof named.code === "string") out.code = named.code;
  return out;
}

function write(level: "info" | "error", line: Record<string, string | number>): void {
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else console.info(text);
}

export function logInfo(event: string, fields?: LogFields): void {
  write("info", sanitize(event, fields));
}

export function logError(event: string, fields?: LogFields): void {
  write("error", sanitize(event, fields));
}

/** Logs a caught exception by class name and code only. */
export function logException(event: string, err: unknown, extra: LogFields = {}): void {
  logError(event, { ...describeError(err), ...extra });
}
