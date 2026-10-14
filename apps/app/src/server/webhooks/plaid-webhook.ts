import { createHash } from "node:crypto";
import type { SyncRepo } from "@/server/sync/repository";
import type { EventPayload, EventsRepo } from "./repository";

/** Plaid webhook bodies are tiny; anything near this size is not one. */
const MAX_BODY_CHARS = 100_000;

export type WebhookDeps = {
  verify: (rawBody: string, token: string | null) => Promise<boolean>;
  repo: Pick<SyncRepo, "ownerForPlaidItem">;
  events: Pick<EventsRepo, "insert">;
  process: (ownerId: string, eventId: string) => Promise<unknown>;
  /** Runs work after the response (Next's `after`). Injected so tests can await it. */
  schedule: (work: () => Promise<void>) => void;
};

const reply = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v !== "" && v.length <= max ? v : undefined;

/**
 * Copies only the fields the provider_events allowlist permits, with their
 * types checked. Free-form text (error messages, institution names, request
 * ids) is never copied.
 */
export function pickPayload(body: Record<string, unknown>): EventPayload {
  const out: EventPayload = {};
  const webhookType = str(body.webhook_type);
  if (webhookType) out.webhook_type = webhookType;
  const webhookCode = str(body.webhook_code);
  if (webhookCode) out.webhook_code = webhookCode;
  const itemId = str(body.item_id);
  if (itemId) out.item_id = itemId;
  const err = body.error;
  if (typeof err === "object" && err !== null) {
    const code = str((err as Record<string, unknown>).error_code);
    if (code) out.error_code = code;
  }
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.length <= 1000 && v.every((x) => typeof x === "string" && x.length <= 200)
      ? (v as string[])
      : undefined;
  const accountIds = strings(body.account_ids);
  if (accountIds) out.account_ids = accountIds;
  const removed = strings(body.removed_transactions);
  if (removed) out.removed_transactions = removed;
  if (typeof body.new_transactions === "number" && Number.isSafeInteger(body.new_transactions)) {
    out.new_transactions = body.new_transactions;
  }
  if (typeof body.initial_update_complete === "boolean") {
    out.initial_update_complete = body.initial_update_complete;
  }
  if (typeof body.historical_update_complete === "boolean") {
    out.historical_update_complete = body.historical_update_complete;
  }
  const environment = str(body.environment, 40);
  if (environment) out.environment = environment;
  return out;
}

export function dedupKeyFor(rawBody: string, type: string, code: string, itemId: string): string {
  return createHash("sha256")
    .update([rawBody, type, code, itemId].join("\n"), "utf8")
    .digest("hex");
}

/**
 * The webhook pipeline, framework-free so it can be tested. Order matters:
 *  1. read the RAW body once (the signature covers its exact bytes);
 *  2. verify the signature; any failure is 401 and nothing is read or written;
 *  3. only then parse, resolve the owner from the Plaid item id, and insert
 *     into provider_events (idempotent on dedup_key);
 *  4. answer 200 quickly and process after the response.
 * Events for an unknown Item, or without an item id, are acknowledged with 200
 * and dropped: retrying cannot make them resolvable.
 */
export async function handlePlaidWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) return reply(413, { error: "Too large" });

  const token = request.headers.get("plaid-verification");
  if (!(await deps.verify(rawBody, token))) return reply(401, { error: "Unauthorized" });

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return reply(400, { error: "Invalid body" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return reply(400, { error: "Invalid body" });
  }
  const record = body as Record<string, unknown>;
  const type = str(record.webhook_type);
  const code = str(record.webhook_code);
  const itemId = str(record.item_id);
  if (!type || !code || !itemId) return reply(200, { ok: true, ignored: true });

  const ownerId = await deps.repo.ownerForPlaidItem(itemId);
  if (!ownerId) return reply(200, { ok: true, ignored: true });

  const stored = await deps.events.insert(ownerId, {
    eventType: type,
    eventCode: code,
    plaidItemId: itemId,
    dedupKey: dedupKeyFor(rawBody, type, code, itemId),
    payload: pickPayload(record),
  });

  // A replay of an event that finished does nothing. A replay of one that
  // failed (processed_at still null) is retried.
  if (!stored.processed) {
    deps.schedule(async () => {
      try {
        await deps.process(ownerId, stored.id);
      } catch {
        // The processor records its own error code; never let it escape.
      }
    });
  }
  return reply(200, { ok: true, duplicate: !stored.inserted });
}
