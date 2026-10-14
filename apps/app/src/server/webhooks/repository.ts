import { withOwner } from "@/server/db";
import type { RunWithOwner } from "@/server/institutions/repository";

/** The only keys that may be stored; matches the provider_events CHECK. */
export type EventPayload = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error_code?: string;
  account_ids?: string[];
  new_transactions?: number;
  removed_transactions?: string[];
  initial_update_complete?: boolean;
  historical_update_complete?: boolean;
  environment?: string;
};

export type StoredEvent = {
  id: string;
  eventType: string;
  eventCode: string | null;
  plaidItemId: string | null;
  payload: EventPayload;
  processedAt: Date | null;
};

export type NewEvent = {
  eventType: string;
  eventCode: string | null;
  plaidItemId: string;
  dedupKey: string;
  payload: EventPayload;
};

/** Persistence for provider_events. All calls run under withOwner. */
export function createEventsRepo(run: RunWithOwner = withOwner) {
  return {
    /** Inserts once per dedup_key. A replay returns the existing row with inserted=false. */
    insert(ownerId: string, e: NewEvent): Promise<{ id: string; inserted: boolean; processed: boolean }> {
      return run(ownerId, async (tx) => {
        const r = await tx.query<{ id: string }>(
          `INSERT INTO provider_events
             (owner_id, provider, event_type, event_code, plaid_item_id, dedup_key, payload)
           VALUES ($1, 'plaid', $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (dedup_key) DO NOTHING
           RETURNING id`,
          [ownerId, e.eventType, e.eventCode, e.plaidItemId, e.dedupKey, JSON.stringify(e.payload)],
        );
        if (r.rows[0]) return { id: r.rows[0].id, inserted: true, processed: false };
        const ex = await tx.query<{ id: string; processed_at: Date | null }>(
          "SELECT id, processed_at FROM provider_events WHERE dedup_key = $1 AND owner_id = $2",
          [e.dedupKey, ownerId],
        );
        const row = ex.rows[0];
        if (!row) throw new Error("Event dedup key collided with another owner");
        return { id: row.id, inserted: false, processed: row.processed_at !== null };
      });
    },

    get(ownerId: string, id: string): Promise<StoredEvent | null> {
      return run(ownerId, async (tx) => {
        const r = await tx.query<{
          id: string;
          event_type: string;
          event_code: string | null;
          plaid_item_id: string | null;
          payload: EventPayload;
          processed_at: Date | null;
        }>(
          `SELECT id, event_type, event_code, plaid_item_id, payload, processed_at
             FROM provider_events WHERE id = $1 AND owner_id = $2`,
          [id, ownerId],
        );
        const x = r.rows[0];
        return x
          ? {
              id: x.id,
              eventType: x.event_type,
              eventCode: x.event_code,
              plaidItemId: x.plaid_item_id,
              payload: x.payload,
              processedAt: x.processed_at,
            }
          : null;
      });
    },

    /** Idempotent: only the first call sets processed_at. */
    markProcessed(ownerId: string, id: string): Promise<boolean> {
      return run(ownerId, async (tx) => {
        const r = await tx.query(
          `UPDATE provider_events SET processed_at = now(), error = NULL
            WHERE id = $1 AND owner_id = $2 AND processed_at IS NULL RETURNING id`,
          [id, ownerId],
        );
        return r.rows.length > 0;
      });
    },

    /** Records a short error code; processed_at stays null so a redelivery retries. */
    markError(ownerId: string, id: string, code: string): Promise<void> {
      return run(ownerId, async (tx) => {
        await tx.query(
          "UPDATE provider_events SET error = $3 WHERE id = $1 AND owner_id = $2 AND processed_at IS NULL",
          [id, ownerId, code.slice(0, 100)],
        );
      });
    },
  };
}

export type EventsRepo = ReturnType<typeof createEventsRepo>;
