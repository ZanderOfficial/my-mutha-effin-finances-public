import { withOwner, queryPrivateLookup, type Queryable } from "@/server/db";
import {
  upsertAccounts,
  type AccountRow,
  type ItemStatus,
  type RunWithOwner,
} from "@/server/institutions/repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 500;

export type SyncItem = {
  id: string;
  plaidItemId: string;
  accessTokenEnc: Uint8Array;
  txCursor: string | null;
  status: ItemStatus;
};

/** A transaction ready to store: cents already normalised (spending negative). */
export type TransactionRow = {
  plaidTransactionId: string;
  plaidAccountId: string;
  amountCents: number;
  date: string;
  pending: boolean;
  name: string;
  merchant: string | null;
  category: string | null;
  categoryDetail: string | null;
  pendingTransactionId: string | null;
};

export type TransactionBatch = { upserts: TransactionRow[]; removedIds: string[] };

export type LiabilityRow = {
  plaidAccountId: string;
  kind: "credit" | "mortgage" | "student" | "loan" | "line_of_credit" | "other";
  nextDueDate: string | null;
  minPaymentCents: number | null;
  lastStatementBalanceCents: number | null;
  lastStatementDate: string | null;
  aprBps: number | null;
  aprType: string | null;
  payoffCents: number | null;
  maturityDate: string | null;
  lastPaymentCents: number | null;
  lastPaymentDate: string | null;
};

export type SecurityRow = {
  plaidSecurityId: string;
  name: string | null;
  ticker: string | null;
  type: string | null;
  closePriceCents: number | null;
  closePriceDate: string | null;
};

export type HoldingRow = {
  plaidAccountId: string;
  plaidSecurityId: string;
  /** Units, as a decimal string. */
  quantity: string;
  institutionValueCents: number | null;
  costBasisCents: number | null;
  asOf: string | null;
};

export type SnapshotAccount = { id: string; isLiability: boolean; balanceCents: number | null };

export type NetWorthRow = {
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  incomplete: boolean;
};

export class UnknownAccountError extends Error {
  constructor() {
    super("A transaction referred to an account that is not stored for this Item");
    this.name = "UnknownAccountError";
  }
}

class CursorConflict extends Error {}

function safeCents(v: string | number | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function accountIdMap(tx: Queryable, ownerId: string, itemId: string) {
  const r = await tx.query<{ id: string; plaid_account_id: string }>(
    "SELECT id, plaid_account_id FROM accounts WHERE owner_id = $1 AND item_id = $2",
    [ownerId, itemId],
  );
  return new Map(r.rows.map((a) => [a.plaid_account_id, a.id]));
}

/** Copies the owner's choice on a pending transaction to the posted one that replaces it. */
async function carryChoicesToPosted(tx: Queryable, ownerId: string, upserts: TransactionRow[]) {
  const posted = upserts.filter((t) => t.pendingTransactionId !== null).map((t) => t.plaidTransactionId);
  if (posted.length === 0) return;

  await tx.query(
    `INSERT INTO transaction_choices (owner_id, transaction_id, kind, business_id, planned_item_id, tax_category_id)
     SELECT posted.owner_id, posted.id, choice.kind, choice.business_id, choice.planned_item_id, choice.tax_category_id
       FROM transactions posted
       JOIN transactions pending
         ON pending.owner_id = posted.owner_id
        AND pending.plaid_transaction_id = posted.pending_transaction_id
       JOIN transaction_choices choice
         ON choice.owner_id = pending.owner_id AND choice.transaction_id = pending.id
      WHERE posted.owner_id = $1 AND posted.plaid_transaction_id = ANY($2::text[])
     ON CONFLICT (transaction_id) DO NOTHING`,
    [ownerId, posted],
  );
}

async function readItem(
  tx: Queryable,
  ownerId: string,
  column: "id" | "plaid_item_id",
  value: string,
): Promise<SyncItem | null> {
  const r = await tx.query<{
    id: string;
    plaid_item_id: string;
    access_token_enc: Uint8Array;
    tx_cursor: string | null;
    status: ItemStatus;
  }>(
    `SELECT id, plaid_item_id, access_token_enc, tx_cursor, status
       FROM items WHERE ${column} = $1 AND owner_id = $2`,
    [value, ownerId],
  );
  const row = r.rows[0];
  return row
    ? {
        id: row.id,
        plaidItemId: row.plaid_item_id,
        accessTokenEnc: row.access_token_enc,
        txCursor: row.tx_cursor,
        status: row.status,
      }
    : null;
}

export type PrivateLookup = <Row>(text: string, params?: unknown[]) => Promise<Row[]>;

/**
 * Persistence for sync. Every owner-scoped call runs in `withOwner`; the two
 * unscoped lookups go through `lookup` (the private.* functions of 0004).
 * Both are injectable so tests can run them against PGlite.
 */
export function createSyncRepo(
  run: RunWithOwner = withOwner,
  lookup: PrivateLookup = queryPrivateLookup,
) {
  return {
    async ownerForPlaidItem(plaidItemId: string): Promise<string | null> {
      const rows = await lookup<{ owner: string | null }>(
        "SELECT private.owner_for_plaid_item($1) AS owner",
        [plaidItemId],
      );
      return rows[0]?.owner ?? null;
    },

    async itemOwnerIds(): Promise<string[]> {
      const rows = await lookup<{ owner: string }>(
        "SELECT owner FROM private.item_owner_ids() AS owner",
      );
      return rows.map((r) => r.owner);
    },

    getItem(ownerId: string, itemId: string): Promise<SyncItem | null> {
      if (!UUID.test(itemId)) return Promise.resolve(null);
      return run(ownerId, (tx) => readItem(tx, ownerId, "id", itemId));
    },

    getItemByPlaidId(ownerId: string, plaidItemId: string): Promise<SyncItem | null> {
      return run(ownerId, (tx) => readItem(tx, ownerId, "plaid_item_id", plaidItemId));
    },

    listItems(ownerId: string): Promise<{ id: string; status: ItemStatus }[]> {
      return run(ownerId, async (tx) => {
        const r = await tx.query<{ id: string; status: ItemStatus }>(
          "SELECT id, status FROM items WHERE owner_id = $1 ORDER BY created_at, id",
          [ownerId],
        );
        return r.rows;
      });
    },

    /** Status changes come from our own stored events or Plaid error codes, never a raw request. */
    setItemStatus(
      ownerId: string,
      itemId: string,
      status: ItemStatus,
      errorCode: string | null,
    ): Promise<boolean> {
      return run(ownerId, async (tx) => {
        const r = await tx.query(
          `UPDATE items SET status = $3, last_error_code = $4, updated_at = now()
            WHERE id = $1 AND owner_id = $2 RETURNING id`,
          [itemId, ownerId, status, errorCode],
        );
        return r.rows.length > 0;
      });
    },

    saveAccounts(ownerId: string, itemId: string, accounts: AccountRow[]): Promise<void> {
      return run(ownerId, (tx) => upsertAccounts(tx, ownerId, itemId, accounts));
    },

    /**
     * Applies a whole sync loop in ONE transaction and moves the cursor only
     * if it is still where this run started (so two concurrent runs cannot
     * move it backwards). Returns "conflict" and writes nothing otherwise.
     */
    async applyTransactions(
      ownerId: string,
      itemId: string,
      startCursor: string | null,
      finalCursor: string,
      batch: TransactionBatch,
    ): Promise<"applied" | "conflict"> {
      try {
        await run(ownerId, async (tx) => {
          const accounts = await accountIdMap(tx, ownerId, itemId);
          for (const t of batch.upserts) {
            if (!accounts.has(t.plaidAccountId)) throw new UnknownAccountError();
          }
          for (const part of chunks(batch.upserts)) {
            await tx.query(
              `INSERT INTO transactions
                 (owner_id, account_id, plaid_transaction_id, amount_cents, date,
                  pending, name, merchant, category, category_detail, pending_transaction_id)
               SELECT $1, t.acct::uuid, t.tid, t.amt::bigint, t.d::date,
                      t.p, t.n, t.m, t.c, t.cd, t.ptid
                 FROM unnest($2::text[], $3::text[], $4::text[], $5::text[],
                             $6::boolean[], $7::text[], $8::text[], $9::text[], $10::text[],
                             $11::text[])
                      AS t(tid, acct, amt, d, p, n, m, c, cd, ptid)
               ON CONFLICT (plaid_transaction_id) DO UPDATE SET
                 account_id = EXCLUDED.account_id,
                 amount_cents = EXCLUDED.amount_cents,
                 date = EXCLUDED.date,
                 pending = EXCLUDED.pending,
                 name = EXCLUDED.name,
                 merchant = EXCLUDED.merchant,
                 category = EXCLUDED.category,
                 category_detail = EXCLUDED.category_detail,
                 pending_transaction_id = EXCLUDED.pending_transaction_id,
                 removed_at = NULL,
                 updated_at = now()
               WHERE transactions.owner_id = EXCLUDED.owner_id`,
              [
                ownerId,
                part.map((t) => t.plaidTransactionId),
                part.map((t) => accounts.get(t.plaidAccountId)),
                part.map((t) => String(t.amountCents)),
                part.map((t) => t.date),
                part.map((t) => t.pending),
                part.map((t) => t.name),
                part.map((t) => t.merchant),
                part.map((t) => t.category),
                part.map((t) => t.categoryDetail),
                part.map((t) => t.pendingTransactionId),
              ],
            );
          }
          await carryChoicesToPosted(tx, ownerId, batch.upserts);
          for (const part of chunks(batch.removedIds)) {
            await tx.query(
              `UPDATE transactions SET removed_at = now(), updated_at = now()
                WHERE owner_id = $1 AND plaid_transaction_id = ANY($2::text[])
                  AND removed_at IS NULL`,
              [ownerId, part],
            );
          }
          const moved = await tx.query(
            `UPDATE items SET tx_cursor = $3, updated_at = now()
              WHERE id = $1 AND owner_id = $2 AND tx_cursor IS NOT DISTINCT FROM $4::text
              RETURNING id`,
            [itemId, ownerId, finalCursor, startCursor],
          );
          if (moved.rows.length === 0) throw new CursorConflict();
        });
        return "applied";
      } catch (err) {
        if (err instanceof CursorConflict) return "conflict";
        throw err;
      }
    },

    saveLiabilities(ownerId: string, itemId: string, rows: LiabilityRow[]): Promise<number> {
      return run(ownerId, async (tx) => {
        const accounts = await accountIdMap(tx, ownerId, itemId);
        let saved = 0;
        for (const l of rows) {
          const accountId = accounts.get(l.plaidAccountId);
          if (!accountId) continue;
          await tx.query(
            `INSERT INTO liabilities
               (owner_id, account_id, kind, next_due_date, min_payment_cents,
                last_statement_balance_cents, last_statement_date, apr_bps, apr_type,
                payoff_cents, maturity_date, last_payment_cents, last_payment_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (account_id) DO UPDATE SET
               kind = EXCLUDED.kind,
               next_due_date = EXCLUDED.next_due_date,
               min_payment_cents = EXCLUDED.min_payment_cents,
               last_statement_balance_cents = EXCLUDED.last_statement_balance_cents,
               last_statement_date = EXCLUDED.last_statement_date,
               apr_bps = EXCLUDED.apr_bps,
               apr_type = EXCLUDED.apr_type,
               payoff_cents = EXCLUDED.payoff_cents,
               maturity_date = EXCLUDED.maturity_date,
               last_payment_cents = EXCLUDED.last_payment_cents,
               last_payment_date = EXCLUDED.last_payment_date,
               updated_at = now()
             WHERE liabilities.owner_id = EXCLUDED.owner_id`,
            [
              ownerId,
              accountId,
              l.kind,
              l.nextDueDate,
              l.minPaymentCents,
              l.lastStatementBalanceCents,
              l.lastStatementDate,
              l.aprBps,
              l.aprType,
              l.payoffCents,
              l.maturityDate,
              l.lastPaymentCents,
              l.lastPaymentDate,
            ],
          );
          saved += 1;
        }
        return saved;
      });
    },

    /**
     * Upserts securities, then replaces the holdings of the listed accounts
     * (a position that is gone must disappear) in one transaction.
     */
    saveHoldings(
      ownerId: string,
      itemId: string,
      input: { accountIds: string[]; securities: SecurityRow[]; holdings: HoldingRow[] },
    ): Promise<number> {
      return run(ownerId, async (tx) => {
        const accounts = await accountIdMap(tx, ownerId, itemId);
        const secIds = new Map<string, string>();
        for (const s of input.securities) {
          const r = await tx.query<{ id: string }>(
            `INSERT INTO securities
               (owner_id, plaid_security_id, name, ticker, type, close_price_cents, close_price_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (owner_id, plaid_security_id) DO UPDATE SET
               name = EXCLUDED.name, ticker = EXCLUDED.ticker, type = EXCLUDED.type,
               close_price_cents = EXCLUDED.close_price_cents,
               close_price_date = EXCLUDED.close_price_date, updated_at = now()
             RETURNING id`,
            [ownerId, s.plaidSecurityId, s.name, s.ticker, s.type, s.closePriceCents, s.closePriceDate],
          );
          secIds.set(s.plaidSecurityId, r.rows[0].id);
        }
        const scoped = new Set<string>(input.accountIds);
        for (const h of input.holdings) scoped.add(h.plaidAccountId);
        const scopedUuids = [...scoped]
          .map((a) => accounts.get(a))
          .filter((x): x is string => Boolean(x));
        if (scopedUuids.length > 0) {
          await tx.query(
            "DELETE FROM holdings WHERE owner_id = $1 AND account_id = ANY($2::uuid[])",
            [ownerId, scopedUuids],
          );
        }
        let saved = 0;
        for (const h of input.holdings) {
          const accountId = accounts.get(h.plaidAccountId);
          const securityId = secIds.get(h.plaidSecurityId);
          if (!accountId || !securityId) continue;
          await tx.query(
            `INSERT INTO holdings
               (owner_id, account_id, security_id, quantity, institution_value_cents,
                cost_basis_cents, as_of)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (account_id, security_id) DO UPDATE SET
               quantity = EXCLUDED.quantity,
               institution_value_cents = EXCLUDED.institution_value_cents,
               cost_basis_cents = EXCLUDED.cost_basis_cents,
               as_of = EXCLUDED.as_of, updated_at = now()`,
            [ownerId, accountId, securityId, h.quantity, h.institutionValueCents, h.costBasisCents, h.asOf],
          );
          saved += 1;
        }
        return saved;
      });
    },

    /**
     * Writes balance_snapshots for every open account with a known balance and
     * hands the account list to `compute`, which returns the net-worth row to
     * upsert (or null to write none). Reruns on the same date overwrite.
     */
    writeSnapshots(
      ownerId: string,
      date: string,
      compute: (accounts: SnapshotAccount[]) => NetWorthRow | null,
    ): Promise<{ snapshots: number; netWorthWritten: boolean }> {
      return run(ownerId, async (tx) => {
        const r = await tx.query<{ id: string; is_liability: boolean; balance_cents: string | null }>(
          `SELECT id, is_liability, balance_cents FROM accounts
            WHERE owner_id = $1 AND closed_at IS NULL ORDER BY id`,
          [ownerId],
        );
        const accounts: SnapshotAccount[] = r.rows.map((a) => ({
          id: a.id,
          isLiability: a.is_liability,
          balanceCents: safeCents(a.balance_cents),
        }));
        let snapshots = 0;
        for (const a of accounts) {
          if (a.balanceCents === null) continue;
          await tx.query(
            `INSERT INTO balance_snapshots (owner_id, account_id, snapshot_date, balance_cents)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (account_id, snapshot_date) DO UPDATE SET balance_cents = EXCLUDED.balance_cents`,
            [ownerId, a.id, date, a.balanceCents],
          );
          snapshots += 1;
        }
        const nw = compute(accounts);
        if (nw) {
          await tx.query(
            `INSERT INTO net_worth_daily
               (owner_id, date, assets_cents, liabilities_cents, net_worth_cents, incomplete, computed_at)
             VALUES ($1,$2,$3,$4,$5,$6, now())
             ON CONFLICT (owner_id, date) DO UPDATE SET
               assets_cents = EXCLUDED.assets_cents,
               liabilities_cents = EXCLUDED.liabilities_cents,
               net_worth_cents = EXCLUDED.net_worth_cents,
               incomplete = EXCLUDED.incomplete,
               computed_at = now()`,
            [ownerId, date, nw.assetsCents, nw.liabilitiesCents, nw.netWorthCents, nw.incomplete],
          );
        }
        return { snapshots, netWorthWritten: nw !== null };
      });
    },
  };
}

export type SyncRepo = ReturnType<typeof createSyncRepo>;
