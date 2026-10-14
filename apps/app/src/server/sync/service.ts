import { decryptToken } from "@/server/crypto/tokens";
import { toCents } from "@/server/institutions/cents";
import { toAccountRow } from "@/server/institutions/repository";
import { PlaidApiError } from "@/server/plaid/errors";
import { itemRef, logException } from "@/server/log";
import type { PlaidProvider, PlaidTransaction } from "@/server/plaid/types";
import { normaliseAmountCents } from "./amounts";
import type { SyncItem, SyncRepo, TransactionRow } from "./repository";

export const MUTATION_ERROR = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
/** The whole loop restarts from the original cursor this many times before giving up. */
export const MAX_RESTARTS = 3;
const MAX_PAGES = 1000;

/** Plaid answers these when an optional product is not enabled for the Item. */
const PRODUCT_UNAVAILABLE = new Set([
  "PRODUCTS_NOT_SUPPORTED",
  "PRODUCT_NOT_READY",
  "NO_LIABILITY_ACCOUNTS",
  "NO_INVESTMENT_ACCOUNTS",
  "INVALID_PRODUCT",
  "ADDITIONAL_CONSENT_REQUIRED",
]);

export type StepResult =
  | { ok: true; detail?: Record<string, number | string | boolean> }
  | { ok: false; code: string };

export type ItemSyncResult = {
  itemId: string;
  balances: StepResult;
  transactions: StepResult;
  liabilities: StepResult;
  holdings: StepResult;
};

export type SyncDeps = {
  plaid: PlaidProvider;
  repo: SyncRepo;
  decrypt?: (ciphertext: Uint8Array) => string;
};

function toRow(t: PlaidTransaction): TransactionRow {
  const cents = normaliseAmountCents(t.amountDollars);
  if (cents === null) throw new RangeError("Transaction amount is not a finite number");
  return {
    plaidTransactionId: t.transactionId,
    plaidAccountId: t.accountId,
    amountCents: cents,
    date: t.date,
    pending: t.pending,
    name: t.name,
    merchant: t.merchantName,
    category: t.categoryPrimary,
    categoryDetail: t.categoryDetailed,
    pendingTransactionId: t.pendingTransactionId ?? null,
  };
}

/** Basis points from a percent (24.99 -> 2499). Same decimal-string maths as cents. */
export function percentToBps(percent: number | null): number | null {
  const bps = toCents(percent);
  return bps === null || bps < 0 ? null : bps;
}

/**
 * Pulls data from Plaid into our tables for one Item. Plaid access tokens are
 * decrypted only inside `withItem`, immediately before the Plaid calls. Every
 * step reports `{ ok: false, code }` rather than throwing on a Plaid error, so
 * one bad Item never stops a batch; ITEM_LOGIN_REQUIRED marks the Item
 * needs_reauth through our own tables. Database errors still propagate to the
 * caller (the processor records a short code).
 */
export function createSyncService(deps: SyncDeps) {
  const { plaid, repo } = deps;
  const decrypt = deps.decrypt ?? ((c: Uint8Array) => decryptToken(c));

  async function withItem(
    ownerId: string,
    itemId: string,
    fn: (accessToken: string, item: SyncItem) => Promise<StepResult>,
  ): Promise<StepResult> {
    const item = await repo.getItem(ownerId, itemId);
    if (!item) return { ok: false, code: "ITEM_NOT_FOUND" };
    if (item.status !== "active") return { ok: false, code: "ITEM_NOT_ACTIVE" };
    try {
      return await fn(decrypt(item.accessTokenEnc), item);
    } catch (err) {
      if (err instanceof PlaidApiError) {
        if (err.isLoginRequired) {
          await repo.setItemStatus(ownerId, itemId, "needs_reauth", err.code);
        }
        return { ok: false, code: err.code };
      }
      throw err;
    }
  }

  async function optionalProduct(fn: () => Promise<StepResult>): Promise<StepResult> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PlaidApiError && PRODUCT_UNAVAILABLE.has(err.code)) {
        return { ok: true, detail: { unavailable: true } };
      }
      throw err;
    }
  }

  /** Cached balances from /accounts/get (free). Never the billed balance endpoint. */
  function refreshBalances(ownerId: string, itemId: string): Promise<StepResult> {
    return withItem(ownerId, itemId, async (token) => {
      const accounts = await plaid.getAccounts(token);
      await repo.saveAccounts(ownerId, itemId, accounts.map(toAccountRow));
      return { ok: true, detail: { accounts: accounts.length } };
    });
  }

  /**
   * The /transactions/sync loop. Pages are gathered in memory from the stored
   * cursor until has_more is false, then applied in ONE owner transaction that
   * also saves the final cursor, so a failure at any point leaves rows and
   * cursor exactly as they were. A mutation-during-pagination error restarts
   * the entire loop from the cursor it began with, as Plaid requires.
   */
  function syncTransactions(ownerId: string, itemId: string): Promise<StepResult> {
    return withItem(ownerId, itemId, async (token, item) => {
      const start = item.txCursor;
      for (let attempt = 0; attempt <= MAX_RESTARTS; attempt += 1) {
        const upserts = new Map<string, TransactionRow>();
        const removed = new Set<string>();
        let cursor = start;
        let pages = 0;
        try {
          for (;;) {
            const page = await plaid.transactionsSync(token, cursor);
            pages += 1;
            for (const t of [...page.added, ...page.modified]) {
              upserts.set(t.transactionId, toRow(t));
              removed.delete(t.transactionId);
            }
            for (const r of page.removed) {
              upserts.delete(r.transactionId);
              removed.add(r.transactionId);
            }
            cursor = page.nextCursor;
            if (!page.hasMore) break;
            if (pages >= MAX_PAGES) throw new PlaidApiError("SYNC_TOO_MANY_PAGES");
          }
        } catch (err) {
          if (err instanceof PlaidApiError && err.code === MUTATION_ERROR && attempt < MAX_RESTARTS) {
            continue;
          }
          throw err;
        }
        const outcome = await repo.applyTransactions(ownerId, itemId, start, cursor as string, {
          upserts: [...upserts.values()],
          removedIds: [...removed],
        });
        return {
          ok: true,
          detail: {
            upserted: upserts.size,
            removed: removed.size,
            ...(outcome === "conflict" ? { skipped: "concurrent_sync" } : {}),
          },
        };
      }
      return { ok: false, code: MUTATION_ERROR };
    });
  }

  function syncLiabilities(ownerId: string, itemId: string): Promise<StepResult> {
    return withItem(ownerId, itemId, (token) =>
      optionalProduct(async () => {
        const list = await plaid.getLiabilities(token);
        const saved = await repo.saveLiabilities(
          ownerId,
          itemId,
          list.map((l) => ({
            plaidAccountId: l.accountId,
            kind: l.kind,
            nextDueDate: l.nextDueDate,
            minPaymentCents: toCents(l.minPaymentDollars),
            lastStatementBalanceCents: toCents(l.lastStatementBalanceDollars),
            lastStatementDate: l.lastStatementDate,
            aprBps: percentToBps(l.aprPercentage),
            aprType: l.aprType,
            payoffCents: toCents(l.payoffDollars),
            maturityDate: l.maturityDate ?? null,
            lastPaymentCents: toCents(l.lastPaymentDollars),
            lastPaymentDate: l.lastPaymentDate ?? null,
          })),
        );
        return { ok: true, detail: { liabilities: saved } };
      }),
    );
  }

  function syncHoldings(ownerId: string, itemId: string): Promise<StepResult> {
    return withItem(ownerId, itemId, (token) =>
      optionalProduct(async () => {
        const data = await plaid.getInvestmentsHoldings(token);
        const saved = await repo.saveHoldings(ownerId, itemId, {
          accountIds: data.accountIds,
          securities: data.securities.map((s) => ({
            plaidSecurityId: s.securityId,
            name: s.name,
            ticker: s.ticker,
            type: s.type,
            closePriceCents: toCents(s.closePriceDollars),
            closePriceDate: s.closePriceAsOf,
          })),
          holdings: data.holdings.map((h) => ({
            plaidAccountId: h.accountId,
            plaidSecurityId: h.securityId,
            quantity: String(h.quantity),
            institutionValueCents: toCents(h.institutionValueDollars),
            costBasisCents: toCents(h.costBasisDollars),
            asOf: h.priceAsOf,
          })),
        });
        return { ok: true, detail: { holdings: saved } };
      }),
    );
  }

  /** Balances first (so every transaction's account exists), then the rest. */
  async function syncItem(ownerId: string, itemId: string): Promise<ItemSyncResult> {
    const balances = await refreshBalances(ownerId, itemId);
    if (!balances.ok) {
      const skipped: StepResult = { ok: false, code: "SKIPPED" };
      return { itemId, balances, transactions: skipped, liabilities: skipped, holdings: skipped };
    }
    const transactions = await syncTransactions(ownerId, itemId);
    const liabilities = await syncLiabilities(ownerId, itemId);
    const holdings = await syncHoldings(ownerId, itemId);
    return { itemId, balances, transactions, liabilities, holdings };
  }

  return {
    refreshBalances,
    syncTransactions,
    syncLiabilities,
    syncHoldings,
    syncItem,

    /** Syncs every Item the owner has; one Item failing never stops the others. */
    async syncAllItems(ownerId: string): Promise<ItemSyncResult[]> {
      const items = await repo.listItems(ownerId);
      const out: ItemSyncResult[] = [];
      for (const i of items) {
        if (i.status !== "active") continue;
        try {
          out.push(await syncItem(ownerId, i.id));
        } catch (err) {
          logException("sync_item_failed", err, { itemRef: itemRef(i.id) });
          const failed: StepResult = { ok: false, code: "INTERNAL" };
          out.push({ itemId: i.id, balances: failed, transactions: failed, liabilities: failed, holdings: failed });
        }
      }
      return out;
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
