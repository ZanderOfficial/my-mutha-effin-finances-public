import { logException } from "@/server/log";
import type { SyncRepo } from "@/server/sync/repository";
import type { StepResult, SyncService } from "@/server/sync/service";
import type { EventsRepo } from "./repository";

export type ProcessOutcome = "processed" | "already_processed" | "missing" | "error";

/** A failed step with one of these codes is handled (the Item is flagged), not retried. */
const HANDLED_CODES = new Set(["ITEM_LOGIN_REQUIRED", "ITEM_NOT_ACTIVE", "ITEM_NOT_FOUND"]);

function firstFailure(steps: StepResult[]): string | null {
  for (const s of steps) {
    if (!s.ok && !HANDLED_CODES.has(s.code)) return s.code;
  }
  return null;
}

/**
 * Acts on a webhook event that is already stored in provider_events. It reads
 * the STORED row (ids and codes only), never the request, and changes an
 * Item status only through our own tables. Safe to run twice: it returns
 * early once processed_at is set, and every ingest is an idempotent upsert, so
 * a concurrent or repeated run changes nothing the second time.
 */
export function createEventProcessor(deps: {
  events: EventsRepo;
  repo: SyncRepo;
  sync: SyncService;
}) {
  const { events, repo, sync } = deps;

  async function dispatch(
    ownerId: string,
    itemId: string,
    type: string,
    code: string | null,
    errorCode: string | undefined,
  ): Promise<string | null> {
    const key = `${type}/${code ?? ""}`;
    switch (key) {
      case "TRANSACTIONS/SYNC_UPDATES_AVAILABLE": {
        const balances = await sync.refreshBalances(ownerId, itemId);
        if (!balances.ok) return firstFailure([balances]);
        return firstFailure([await sync.syncTransactions(ownerId, itemId)]);
      }
      case "HOLDINGS/DEFAULT_UPDATE":
      case "INVESTMENTS_TRANSACTIONS/DEFAULT_UPDATE": {
        const balances = await sync.refreshBalances(ownerId, itemId);
        if (!balances.ok) return firstFailure([balances]);
        return firstFailure([await sync.syncHoldings(ownerId, itemId)]);
      }
      case "LIABILITIES/DEFAULT_UPDATE": {
        const balances = await sync.refreshBalances(ownerId, itemId);
        if (!balances.ok) return firstFailure([balances]);
        return firstFailure([await sync.syncLiabilities(ownerId, itemId)]);
      }
      case "ITEM/ERROR":
        if (errorCode === "ITEM_LOGIN_REQUIRED") {
          await repo.setItemStatus(ownerId, itemId, "needs_reauth", errorCode);
        }
        return null;
      case "ITEM/PENDING_EXPIRATION":
      case "ITEM/PENDING_DISCONNECT":
        await repo.setItemStatus(ownerId, itemId, "needs_reauth", code);
        return null;
      case "ITEM/LOGIN_REPAIRED": {
        const item = await repo.getItem(ownerId, itemId);
        if (item?.status === "needs_reauth") {
          await repo.setItemStatus(ownerId, itemId, "active", null);
          const r = await sync.syncItem(ownerId, itemId);
          return firstFailure([r.balances, r.transactions, r.liabilities, r.holdings]);
        }
        return null;
      }
      case "ITEM/USER_PERMISSION_REVOKED":
        await repo.setItemStatus(ownerId, itemId, "revoked", code);
        return null;
      default:
        // Webhooks we do not act on (INITIAL_UPDATE and the like): stored, then done.
        return null;
    }
  }

  return {
    async process(ownerId: string, eventId: string): Promise<ProcessOutcome> {
      const event = await events.get(ownerId, eventId);
      if (!event) return "missing";
      if (event.processedAt) return "already_processed";
      try {
        const item = event.plaidItemId
          ? await repo.getItemByPlaidId(ownerId, event.plaidItemId)
          : null;
        // An Item unlinked since delivery has nothing left to update.
        const failure = item
          ? await dispatch(ownerId, item.id, event.eventType, event.eventCode, event.payload.error_code)
          : null;
        if (failure) {
          await events.markError(ownerId, eventId, failure);
          return "error";
        }
        await events.markProcessed(ownerId, eventId);
        return "processed";
      } catch (err) {
        logException("webhook_event_failed", err);
        try {
          await events.markError(ownerId, eventId, "INTERNAL");
        } catch {
          // Nothing more to record; the event stays unprocessed and is retried.
        }
        return "error";
      }
    },
  };
}

export type EventProcessor = ReturnType<typeof createEventProcessor>;
