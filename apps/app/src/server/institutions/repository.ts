import { withOwner, type Queryable } from "@/server/db";
import type { EncryptedToken } from "@/server/crypto/tokens";
import type { PlaidAccountInfo } from "@/server/plaid/types";
import { toCents } from "./cents";

/** The owner may link at most this many institutions (Plaid free-tier Items). */
export const MAX_LINKED_ITEMS = 10;

export type ItemStatus = "active" | "needs_reauth" | "revoked";

export class ItemCapReachedError extends Error {
  constructor() {
    super(`At most ${MAX_LINKED_ITEMS} institutions can be linked`);
    this.name = "ItemCapReachedError";
  }
}

/** Account columns as stored. All money is integer cents; null is unknown. */
export type AccountRow = {
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  /**
   * True for Plaid account types `credit` and `loan`. Plaid reports the amount
   * OWED as a positive balance. We store that raw positive value and flag the
   * row, so net-worth maths subtracts it later (assets minus liabilities).
   * Nothing is negated at ingest.
   */
  isLiability: boolean;
  balanceCents: number | null;
  availableCents: number | null;
  limitCents: number | null;
  isoCurrencyCode: string | null;
  mask: string | null;
};

export function isLiabilityType(type: string): boolean {
  return type === "credit" || type === "loan";
}

/** Maps Plaid's neutral account info to stored columns (cents, truncated mask). */
export function toAccountRow(a: PlaidAccountInfo): AccountRow {
  return {
    plaidAccountId: a.accountId,
    name: a.name,
    officialName: a.officialName,
    type: a.type,
    subtype: a.subtype,
    isLiability: isLiabilityType(a.type),
    balanceCents: toCents(a.currentDollars),
    availableCents: toCents(a.availableDollars),
    limitCents: toCents(a.limitDollars),
    isoCurrencyCode: a.isoCurrencyCode,
    mask: a.mask ? a.mask.slice(-4) : null,
  };
}

export type NewItem = {
  plaidItemId: string;
  token: EncryptedToken;
  institutionId: string | null;
  institutionName: string | null;
  status: ItemStatus;
  lastErrorCode: string | null;
  accounts: AccountRow[];
};

export type ItemSecret = {
  id: string;
  plaidItemId: string;
  accessTokenEnc: Uint8Array;
  keyVersion: number;
};

export type AccountView = {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  isLiability: boolean;
  mask: string | null;
  /** Raw stored balance; for liabilities this is the positive amount owed. */
  balanceCents: number | null;
};

export type InstitutionView = {
  id: string;
  institutionName: string | null;
  status: ItemStatus;
  accounts: AccountView[];
};

export type RunWithOwner = <T>(
  ownerId: string,
  fn: (tx: Queryable) => Promise<T>,
) => Promise<T>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** bigint arrives from the driver as a string; unsafe values become unknown. */
function safeCents(value: string | number | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export async function upsertAccounts(
  tx: Queryable,
  ownerId: string,
  itemId: string,
  accounts: AccountRow[],
): Promise<void> {
  for (const a of accounts) {
    await tx.query(
      `INSERT INTO accounts
         (owner_id, item_id, plaid_account_id, name, official_name, type, subtype,
          is_liability, balance_cents, available_cents, limit_cents,
          iso_currency_code, mask, balance_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       ON CONFLICT (plaid_account_id) DO UPDATE SET
         name = EXCLUDED.name,
         official_name = EXCLUDED.official_name,
         type = EXCLUDED.type,
         subtype = EXCLUDED.subtype,
         is_liability = EXCLUDED.is_liability,
         balance_cents = EXCLUDED.balance_cents,
         available_cents = EXCLUDED.available_cents,
         limit_cents = EXCLUDED.limit_cents,
         iso_currency_code = EXCLUDED.iso_currency_code,
         mask = EXCLUDED.mask,
         balance_updated_at = now(),
         updated_at = now()
       WHERE accounts.owner_id = EXCLUDED.owner_id`,
      [
        ownerId,
        itemId,
        a.plaidAccountId,
        a.name,
        a.officialName,
        a.type,
        a.subtype,
        a.isLiability,
        a.balanceCents,
        a.availableCents,
        a.limitCents,
        a.isoCurrencyCode,
        a.mask,
      ],
    );
  }
}

/**
 * Persistence for Items and accounts. Every call runs inside `withOwner`, so
 * row-level security scopes it to the owner; queries also name owner_id so a
 * policy mistake cannot widen them. `run` is injectable for tests (PGlite).
 */
export function createInstitutionRepo(run: RunWithOwner = withOwner) {
  return {
    countItems(ownerId: string): Promise<number> {
      return run(ownerId, async (tx) => {
        const r = await tx.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM items WHERE owner_id = $1",
          [ownerId],
        );
        return Number(r.rows[0].n);
      });
    },

    countNeedsReauth(ownerId: string): Promise<number> {
      return run(ownerId, async (tx) => {
        const r = await tx.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM items WHERE owner_id = $1 AND status = 'needs_reauth'",
          [ownerId],
        );
        return Number(r.rows[0].n);
      });
    },

    /**
     * Saves an Item with its encrypted token and upserts its accounts in one
     * transaction. Re-checks the cap under an advisory lock so two concurrent
     * links cannot both slip past it. Returns the new row id.
     */
    saveItem(ownerId: string, item: NewItem): Promise<string> {
      return run(ownerId, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ownerId]);
        const c = await tx.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM items WHERE owner_id = $1 AND plaid_item_id <> $2",
          [ownerId, item.plaidItemId],
        );
        if (Number(c.rows[0].n) >= MAX_LINKED_ITEMS) throw new ItemCapReachedError();

        const r = await tx.query<{ id: string }>(
          `INSERT INTO items
             (owner_id, plaid_item_id, access_token_enc, key_version, status,
              last_error_code, institution_id, institution_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (plaid_item_id) DO UPDATE SET
             access_token_enc = EXCLUDED.access_token_enc,
             key_version = EXCLUDED.key_version,
             status = EXCLUDED.status,
             last_error_code = EXCLUDED.last_error_code,
             institution_id = EXCLUDED.institution_id,
             institution_name = EXCLUDED.institution_name,
             updated_at = now()
           WHERE items.owner_id = EXCLUDED.owner_id
           RETURNING id`,
          [
            ownerId,
            item.plaidItemId,
            item.token.ciphertext,
            item.token.keyVersion,
            item.status,
            item.lastErrorCode,
            item.institutionId,
            item.institutionName,
          ],
        );
        const id = r.rows[0]?.id;
        if (!id) throw new Error("Item could not be saved");
        await upsertAccounts(tx, ownerId, id, item.accounts);
        return id;
      });
    },

    /** Refreshes accounts and status for an existing Item (after a repair or refresh). */
    updateItemFromPlaid(
      ownerId: string,
      itemId: string,
      update: { status: ItemStatus; lastErrorCode: string | null; accounts: AccountRow[] | null },
    ): Promise<boolean> {
      return run(ownerId, async (tx) => {
        const r = await tx.query(
          `UPDATE items SET status = $3, last_error_code = $4, updated_at = now()
            WHERE id = $1 AND owner_id = $2 RETURNING id`,
          [itemId, ownerId, update.status, update.lastErrorCode],
        );
        if (r.rows.length === 0) return false;
        if (update.accounts) await upsertAccounts(tx, ownerId, itemId, update.accounts);
        return true;
      });
    },

    markNeedsReauth(ownerId: string, itemId: string, errorCode: string): Promise<boolean> {
      if (!UUID.test(itemId)) return Promise.resolve(false);
      return run(ownerId, async (tx) => {
        const r = await tx.query(
          `UPDATE items SET status = 'needs_reauth', last_error_code = $3, updated_at = now()
            WHERE id = $1 AND owner_id = $2 RETURNING id`,
          [itemId, ownerId, errorCode],
        );
        return r.rows.length > 0;
      });
    },

    /** The encrypted token for an Item the owner owns, or null. */
    getItemSecret(ownerId: string, itemId: string): Promise<ItemSecret | null> {
      if (!UUID.test(itemId)) return Promise.resolve(null);
      return run(ownerId, async (tx) => {
        const r = await tx.query<{
          id: string;
          plaid_item_id: string;
          access_token_enc: Uint8Array;
          key_version: number;
        }>(
          `SELECT id, plaid_item_id, access_token_enc, key_version
             FROM items WHERE id = $1 AND owner_id = $2`,
          [itemId, ownerId],
        );
        const row = r.rows[0];
        return row
          ? {
              id: row.id,
              plaidItemId: row.plaid_item_id,
              accessTokenEnc: row.access_token_enc,
              keyVersion: row.key_version,
            }
          : null;
      });
    },

    /** Deletes the Item; accounts and their history go with it (ON DELETE CASCADE). */
    deleteItem(ownerId: string, itemId: string): Promise<boolean> {
      if (!UUID.test(itemId)) return Promise.resolve(false);
      return run(ownerId, async (tx) => {
        const r = await tx.query(
          "DELETE FROM items WHERE id = $1 AND owner_id = $2 RETURNING id",
          [itemId, ownerId],
        );
        return r.rows.length > 0;
      });
    },

    /** Institutions with their accounts. Never returns tokens or Plaid ids. */
    listInstitutions(ownerId: string): Promise<InstitutionView[]> {
      return run(ownerId, async (tx) => {
        const items = await tx.query<{
          id: string;
          institution_name: string | null;
          status: ItemStatus;
        }>(
          `SELECT id, institution_name, status FROM items
            WHERE owner_id = $1 ORDER BY created_at, id`,
          [ownerId],
        );
        const accounts = await tx.query<{
          id: string;
          item_id: string;
          name: string;
          type: string;
          subtype: string | null;
          is_liability: boolean;
          mask: string | null;
          balance_cents: string | null;
        }>(
          `SELECT id, item_id, name, type, subtype, is_liability, mask, balance_cents
             FROM accounts WHERE owner_id = $1 AND closed_at IS NULL
            ORDER BY created_at, name, id`,
          [ownerId],
        );
        return items.rows.map((i) => ({
          id: i.id,
          institutionName: i.institution_name,
          status: i.status,
          accounts: accounts.rows
            .filter((a) => a.item_id === i.id)
            .map((a) => ({
              id: a.id,
              name: a.name,
              type: a.type,
              subtype: a.subtype,
              isLiability: a.is_liability,
              mask: a.mask,
              balanceCents: safeCents(a.balance_cents),
            })),
        }));
      });
    },
  };
}

export type InstitutionRepo = ReturnType<typeof createInstitutionRepo>;
