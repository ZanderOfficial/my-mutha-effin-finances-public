import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PlaidApiError } from "@/server/plaid/errors";
import type { PlaidProvider, TransactionsSyncPage } from "@/server/plaid/types";
import { createSyncService, MAX_RESTARTS, MUTATION_ERROR, percentToBps } from "./service";
import {
  account,
  accountInfo,
  fakeDecrypt,
  fakePlaid,
  page,
  seedItem,
  setupDb,
  txn,
} from "./test-helpers";

let ctx: Awaited<ReturnType<typeof setupDb>>;
const A = "owner-a-sync";
const B = "owner-b-sync";
const C = "owner-c-sync";
const D = "owner-d-sync";

beforeAll(async () => {
  ctx = await setupDb();
});
afterAll(async () => {
  await ctx.pg.close();
});

const svc = (plaid: PlaidProvider) =>
  createSyncService({ plaid, repo: ctx.syncRepo, decrypt: fakeDecrypt });

/** A provider that serves scripted pages in order and records the cursors it was asked for. */
function pagedPlaid(script: (TransactionsSyncPage | Error)[], over: Partial<PlaidProvider> = {}) {
  const cursors: (string | null)[] = [];
  let i = 0;
  const transactionsSync = vi.fn(async (_t: string, cursor: string | null) => {
    cursors.push(cursor);
    const next = script[i++];
    if (!next) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return next;
  });
  return { plaid: fakePlaid({ transactionsSync, ...over }), cursors, transactionsSync };
}

const rows = async (owner: string, sql: string, params: unknown[] = []) =>
  ctx.run(owner, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);
const cursorOf = async (owner: string, itemId: string) =>
  (await rows(owner, "SELECT tx_cursor FROM items WHERE id = $1", [itemId]))[0].tx_cursor;

describe("transactions sync loop", () => {
  it("walks every page, normalises sign, and saves the cursor once at the end", async () => {
    const itemId = await seedItem(ctx, A, "pi-loop", [account("pa-loop")]);
    const { plaid, cursors } = pagedPlaid([
      page({
        added: [txn("t1", "pa-loop", 4.5, { merchantName: "Cafe" }), txn("t2", "pa-loop", -2000, { name: "Payroll" })],
        nextCursor: "c1",
        hasMore: true,
      }),
      page({ added: [txn("t3", "pa-loop", 12.34, { pending: true })], nextCursor: "c2", hasMore: false }),
    ]);
    plaid.getAccounts = vi.fn(async () => [accountInfo("pa-loop")]);

    const r = await svc(plaid).syncItem(A, itemId);
    expect(r.transactions.ok).toBe(true);
    expect(cursors).toEqual([null, "c1"]);
    expect(await cursorOf(A, itemId)).toBe("c2");

    const t = await rows(A, "SELECT plaid_transaction_id AS id, amount_cents, pending, merchant, category FROM transactions WHERE owner_id = $1 ORDER BY plaid_transaction_id", [A]);
    const byId = Object.fromEntries(t.map((x) => [x.id, x]));
    expect(Number(byId.t1.amount_cents)).toBe(-450);
    expect(Number(byId.t2.amount_cents)).toBe(200000);
    expect(Number(byId.t3.amount_cents)).toBe(-1234);
    expect(byId.t3.pending).toBe(true);
    expect(byId.t1.merchant).toBe("Cafe");
    expect(byId.t1.category).toBe("FOOD_AND_DRINK");
  });

  it("carries a choice from a pending transaction to the posted one that replaces it", async () => {
    const P = "owner-pending-sync";
    const itemId = await seedItem(ctx, P, "pi-pending", [account("pa-pend")]);
    const first = pagedPlaid([
      page({ added: [txn("tp-pending", "pa-pend", -50, { pending: true })], nextCursor: "p1" }),
    ]);
    await svc(first.plaid).syncTransactions(P, itemId);
    const [pending] = await rows(P, "SELECT id FROM transactions WHERE plaid_transaction_id = 'tp-pending'");
    await ctx.run(P, (tx) =>
      tx.query("INSERT INTO transaction_choices (owner_id, transaction_id, kind) VALUES ($1, $2, 'income')", [P, pending.id]),
    );

    // Plaid removes the pending copy and adds the posted one, pointing back at it.
    const second = pagedPlaid([
      page({
        removed: [{ transactionId: "tp-pending", accountId: "pa-pend" }],
        added: [txn("tp-posted", "pa-pend", -50, { pendingTransactionId: "tp-pending" })],
        nextCursor: "p2",
      }),
    ]);
    await svc(second.plaid).syncTransactions(P, itemId);

    const carried = await rows(
      P,
      `SELECT c.kind, t.pending_transaction_id FROM transaction_choices c
         JOIN transactions t ON t.id = c.transaction_id WHERE t.plaid_transaction_id = 'tp-posted'`,
    );
    expect(carried).toEqual([{ kind: "income", pending_transaction_id: "tp-pending" }]);
  });

  it("carries a budget match on pending spending to the posted transaction", async () => {
    const P = "owner-pending-budget";
    const itemId = await seedItem(ctx, P, "pi-pending-budget", [account("pa-pend-budget")]);
    const first = pagedPlaid([
      page({ added: [txn("tb-pending", "pa-pend-budget", 40, { pending: true })], nextCursor: "b1" }),
    ]);
    await svc(first.plaid).syncTransactions(P, itemId);
    await ctx.run(P, async (tx) => {
      const item = await tx.query<{ id: string }>(
        "INSERT INTO planned_items (owner_id, name, amount_cents, frequency) VALUES ($1, 'Gym', 4000, 'monthly') RETURNING id",
        [P],
      );
      await tx.query(
        `INSERT INTO transaction_choices (owner_id, transaction_id, kind, planned_item_id)
         SELECT $1, id, 'planned_item', $2 FROM transactions WHERE plaid_transaction_id = 'tb-pending'`,
        [P, item.rows[0].id],
      );
    });

    const second = pagedPlaid([
      page({
        removed: [{ transactionId: "tb-pending", accountId: "pa-pend-budget" }],
        added: [txn("tb-posted", "pa-pend-budget", 40, { pendingTransactionId: "tb-pending" })],
        nextCursor: "b2",
      }),
    ]);
    await svc(second.plaid).syncTransactions(P, itemId);

    const carried = await rows(
      P,
      `SELECT c.kind, i.name FROM transaction_choices c
         JOIN transactions t ON t.id = c.transaction_id
         JOIN planned_items i ON i.id = c.planned_item_id
        WHERE t.plaid_transaction_id = 'tb-posted'`,
    );
    expect(carried).toEqual([{ kind: "planned_item", name: "Gym" }]);
  });

  it("leaves rows and cursor untouched when a later page fails", async () => {
    const itemId = await seedItem(ctx, A, "pi-fail", [account("pa-fail")]);
    await ctx.run(A, (tx) => tx.query("UPDATE items SET tx_cursor = 'start' WHERE id = $1", [itemId]));
    const { plaid } = pagedPlaid([
      page({ added: [txn("tf1", "pa-fail", 1)], nextCursor: "c1", hasMore: true }),
      new PlaidApiError("RATE_LIMIT"),
    ]);
    plaid.getAccounts = vi.fn(async () => [accountInfo("pa-fail")]);

    const r = await svc(plaid).syncItem(A, itemId);
    expect(r.transactions).toEqual({ ok: false, code: "RATE_LIMIT" });
    expect(await cursorOf(A, itemId)).toBe("start");
    expect(await rows(A, "SELECT 1 FROM transactions WHERE plaid_transaction_id = 'tf1'")).toHaveLength(0);
  });

  it("restarts the whole loop from the original cursor on a mutation during pagination", async () => {
    const itemId = await seedItem(ctx, A, "pi-mut", [account("pa-mut")]);
    await ctx.run(A, (tx) => tx.query("UPDATE items SET tx_cursor = 'orig' WHERE id = $1", [itemId]));
    const { plaid, cursors } = pagedPlaid([
      page({ added: [txn("tm-stale", "pa-mut", 9)], nextCursor: "c1", hasMore: true }),
      new PlaidApiError(MUTATION_ERROR),
      page({ added: [txn("tm1", "pa-mut", 5)], nextCursor: "d1", hasMore: true }),
      page({ added: [txn("tm2", "pa-mut", 6)], nextCursor: "d2", hasMore: false }),
    ]);
    plaid.getAccounts = vi.fn(async () => [accountInfo("pa-mut")]);

    const r = await svc(plaid).syncItem(A, itemId);
    expect(r.transactions.ok).toBe(true);
    expect(cursors).toEqual(["orig", "c1", "orig", "d1"]);
    expect(await cursorOf(A, itemId)).toBe("d2");
    const ids = (await rows(A, "SELECT plaid_transaction_id AS id FROM transactions WHERE plaid_transaction_id LIKE 'tm%' ORDER BY 1")).map((x) => x.id);
    expect(ids).toEqual(["tm1", "tm2"]);
  });

  it("gives up after MAX_RESTARTS restarts without writing anything", async () => {
    const itemId = await seedItem(ctx, A, "pi-mut2", [account("pa-mut2")]);
    const { plaid, transactionsSync } = pagedPlaid(
      Array.from({ length: MAX_RESTARTS + 1 }, () => new PlaidApiError(MUTATION_ERROR)),
    );
    plaid.getAccounts = vi.fn(async () => [accountInfo("pa-mut2")]);
    const r = await svc(plaid).syncItem(A, itemId);
    expect(r.transactions).toEqual({ ok: false, code: MUTATION_ERROR });
    expect(transactionsSync).toHaveBeenCalledTimes(MAX_RESTARTS + 1);
    expect(await cursorOf(A, itemId)).toBeNull();
  });

  it("handles modified and removed: soft delete, update in place, idempotent reruns", async () => {
    const itemId = await seedItem(ctx, A, "pi-rm", [account("pa-rm")]);
    const first = pagedPlaid([
      page({
        added: [txn("tr1", "pa-rm", 10, { pending: true }), txn("tr2", "pa-rm", 20), txn("tr3", "pa-rm", 30)],
        nextCursor: "r1",
      }),
    ]);
    first.plaid.getAccounts = vi.fn(async () => [accountInfo("pa-rm")]);
    await svc(first.plaid).syncItem(A, itemId);
    await svc(first.plaid).syncItem(A, itemId).catch(() => undefined);

    const second = pagedPlaid([
      page({
        added: [txn("tr4", "pa-rm", 1), txn("tr5", "pa-rm", 2)],
        modified: [txn("tr1", "pa-rm", 10.5, { pending: false })],
        removed: [
          { transactionId: "tr2", accountId: "pa-rm" },
          // Added and removed inside one loop: must end up not stored at all.
          { transactionId: "tr5", accountId: "pa-rm" },
        ],
        nextCursor: "r2",
      }),
    ]);
    second.plaid.getAccounts = vi.fn(async () => [accountInfo("pa-rm")]);
    await svc(second.plaid).syncItem(A, itemId);

    const t = await rows(A, "SELECT plaid_transaction_id AS id, amount_cents, pending, removed_at FROM transactions WHERE plaid_transaction_id LIKE 'tr%' ORDER BY 1");
    const by = Object.fromEntries(t.map((x) => [x.id, x]));
    expect(Number(by.tr1.amount_cents)).toBe(-1050);
    expect(by.tr1.pending).toBe(false);
    expect(by.tr2.removed_at).not.toBeNull();
    expect(by.tr3.removed_at).toBeNull();
    expect(by.tr4.removed_at).toBeNull();
    expect(by.tr5).toBeUndefined();
    expect(t).toHaveLength(4);
  });

  it("marks the Item needs_reauth on ITEM_LOGIN_REQUIRED and the batch carries on", async () => {
    const bad = await seedItem(ctx, A, "pi-bad", [account("pa-bad")]);
    const good = await seedItem(ctx, A, "pi-good", [account("pa-good")]);
    const plaid = fakePlaid({
      getAccounts: vi.fn(async () => [accountInfo("pa-good")]),
      transactionsSync: vi.fn(async () => page({ added: [txn("tg1", "pa-good", 3)], nextCursor: "g1" })),
    });
    // The first Item's token is "rejected" by Plaid; the second is fine.
    let calls = 0;
    plaid.getAccounts = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new PlaidApiError("ITEM_LOGIN_REQUIRED");
      return [accountInfo("pa-good")];
    });
    // Only these two Items are of interest; run just them rather than every Item.
    const s = svc(plaid);
    const r1 = await s.syncItem(A, bad);
    const r2 = await s.syncItem(A, good);
    expect(r1.balances).toEqual({ ok: false, code: "ITEM_LOGIN_REQUIRED" });
    expect(r1.transactions).toEqual({ ok: false, code: "SKIPPED" });
    expect(r2.transactions.ok).toBe(true);

    const st = await rows(A, "SELECT id, status, last_error_code FROM items WHERE id = ANY($1::uuid[])", [[bad, good]]);
    const by = Object.fromEntries(st.map((x) => [x.id, x]));
    expect(by[bad]).toMatchObject({ status: "needs_reauth", last_error_code: "ITEM_LOGIN_REQUIRED" });
    expect(by[good].status).toBe("active");

    // A needs_reauth Item is skipped without calling Plaid again.
    const again = vi.fn(async () => []);
    const r3 = await svc(fakePlaid({ getAccounts: again })).syncItem(A, bad);
    expect(r3.balances).toEqual({ ok: false, code: "ITEM_NOT_ACTIVE" });
    expect(again).not.toHaveBeenCalled();
  });

  it("syncAllItems isolates a thrown error to its own Item", async () => {
    const owner = "owner-batch";
    const one = await seedItem(ctx, owner, "pi-b1", [account("pa-b1")]);
    await seedItem(ctx, owner, "pi-b2", [account("pa-b2")]);
    let n = 0;
    const plaid = fakePlaid({
      getAccounts: vi.fn(async () => {
        n += 1;
        if (n === 1) throw new Error("boom");
        return [accountInfo("pa-b2")];
      }),
      transactionsSync: vi.fn(async () => page({ nextCursor: "b" })),
    });
    const results = await svc(plaid).syncAllItems(owner);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.itemId === one)?.balances).toEqual({ ok: false, code: "INTERNAL" });
    expect(results.filter((r) => r.transactions.ok)).toHaveLength(1);
  });

  it("refuses a transaction for an account the Item does not have, writing nothing", async () => {
    const itemId = await seedItem(ctx, A, "pi-unk", [account("pa-unk")]);
    const { plaid } = pagedPlaid([page({ added: [txn("tu1", "pa-elsewhere", 1)], nextCursor: "u1" })]);
    plaid.getAccounts = vi.fn(async () => [accountInfo("pa-unk")]);
    await expect(svc(plaid).syncItem(A, itemId)).rejects.toThrow();
    expect(await cursorOf(A, itemId)).toBeNull();
  });
});

describe("accounts, liabilities and holdings", () => {
  it("refreshes balances as cents without touching the billed endpoint", async () => {
    const itemId = await seedItem(ctx, A, "pi-bal", [account("pa-bal", { balanceCents: 1 })]);
    const plaid = fakePlaid({
      getAccounts: vi.fn(async () => [accountInfo("pa-bal", { currentDollars: 1234.56 })]),
    });
    await svc(plaid).refreshBalances(A, itemId);
    const r = await rows(A, "SELECT balance_cents FROM accounts WHERE plaid_account_id = 'pa-bal'");
    expect(Number(r[0].balance_cents)).toBe(123456);
  });

  it("ingests credit liabilities as cents and integer basis points, idempotently", async () => {
    const itemId = await seedItem(ctx, A, "pi-liab", [
      account("pa-card", { type: "credit", isLiability: true, balanceCents: 5000 }),
    ]);
    const getLiabilities = vi.fn(async () => [
      {
        accountId: "pa-card",
        kind: "credit" as const,
        nextDueDate: "2026-02-01",
        minPaymentDollars: 25,
        lastStatementBalanceDollars: 123.45,
        lastStatementDate: "2026-01-10",
        aprPercentage: 24.99,
        aprType: "purchase_apr",
      },
    ]);
    const s = svc(fakePlaid({ getLiabilities }));
    await s.syncLiabilities(A, itemId);
    await s.syncLiabilities(A, itemId);
    const r = await rows(A, "SELECT * FROM liabilities WHERE owner_id = $1 AND kind = 'credit'", [A]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ apr_bps: 2499, apr_type: "purchase_apr" });
    expect(Number(r[0].min_payment_cents)).toBe(2500);
    expect(Number(r[0].last_statement_balance_cents)).toBe(12345);
    expect(String(r[0].next_due_date)).toContain("2026");
  });

  it("ingests an auto loan's payment, rate, payoff, end date and last payment", async () => {
    const L = "owner-loan-sync";
    const itemId = await seedItem(ctx, L, "pi-loan", [
      account("pa-auto", { type: "loan", subtype: "auto", isLiability: true, balanceCents: 1200000 }),
    ]);
    const getLiabilities = vi.fn(async () => [
      {
        accountId: "pa-auto",
        kind: "loan" as const,
        nextDueDate: "2026-02-15",
        minPaymentDollars: 284,
        lastStatementBalanceDollars: null,
        lastStatementDate: null,
        aprPercentage: 6.49,
        aprType: "fixed",
        payoffDollars: 12345.67,
        maturityDate: "2029-03-15",
        lastPaymentDollars: 284,
        lastPaymentDate: "2026-01-15",
      },
    ]);
    await svc(fakePlaid({ getLiabilities })).syncLiabilities(L, itemId);
    const r = await rows(
      L,
      `SELECT kind, apr_bps, apr_type, min_payment_cents, payoff_cents, last_payment_cents,
              to_char(maturity_date, 'YYYY-MM-DD') AS maturity, to_char(last_payment_date, 'YYYY-MM-DD') AS last_paid
         FROM liabilities WHERE owner_id = $1 AND kind = 'loan'`,
      [L],
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "loan", apr_bps: 649, apr_type: "fixed", maturity: "2029-03-15", last_paid: "2026-01-15" });
    expect(Number(r[0].min_payment_cents)).toBe(28400);
    expect(Number(r[0].payoff_cents)).toBe(1234567);
    expect(Number(r[0].last_payment_cents)).toBe(28400);
  });

  it("leaves the loan-only columns empty for a credit card", async () => {
    const r = await rows(
      A,
      "SELECT payoff_cents, maturity_date, last_payment_cents, last_payment_date FROM liabilities WHERE owner_id = $1 AND kind = 'credit'",
      [A],
    );
    expect(r[0]).toEqual({ payoff_cents: null, maturity_date: null, last_payment_cents: null, last_payment_date: null });
  });

  it("treats an optional product the Item lacks as available-nowhere, not as an error", async () => {
    const itemId = await seedItem(ctx, C, "pi-noprod", [account("pa-noprod")]);
    const plaid = fakePlaid({
      getLiabilities: vi.fn(async () => {
        throw new PlaidApiError("PRODUCTS_NOT_SUPPORTED");
      }),
    });
    expect(await svc(plaid).syncLiabilities(C, itemId)).toEqual({ ok: true, detail: { unavailable: true } });
  });

  it("stores holdings and securities in cents and drops sold positions", async () => {
    const itemId = await seedItem(ctx, C, "pi-inv", [account("pa-inv", { type: "investment" })]);
    const holdings = (secIds: string[]) => ({
      accountIds: ["pa-inv"],
      securities: secIds.map((id) => ({
        securityId: id,
        name: id,
        ticker: id.toUpperCase(),
        type: "equity",
        closePriceDollars: 10.25,
        closePriceAsOf: "2026-01-14",
      })),
      holdings: secIds.map((id) => ({
        accountId: "pa-inv",
        securityId: id,
        quantity: 2.5,
        institutionValueDollars: 25.63,
        costBasisDollars: 20,
        priceAsOf: "2026-01-14",
      })),
    });
    const getInvestmentsHoldings = vi.fn(async () => holdings(["s1", "s2"]));
    const s = svc(fakePlaid({ getInvestmentsHoldings }));
    await s.syncHoldings(C, itemId);
    await s.syncHoldings(C, itemId);
    let r = await rows(C, "SELECT h.quantity, h.institution_value_cents, h.cost_basis_cents, s.close_price_cents FROM holdings h JOIN securities s ON s.id = h.security_id WHERE h.owner_id = $1", [C]);
    expect(r).toHaveLength(2);
    expect(Number(r[0].institution_value_cents)).toBe(2563);
    expect(Number(r[0].cost_basis_cents)).toBe(2000);
    expect(Number(r[0].close_price_cents)).toBe(1025);
    expect(Number(r[0].quantity)).toBe(2.5);

    getInvestmentsHoldings.mockImplementation(async () => holdings(["s1"]));
    await s.syncHoldings(C, itemId);
    r = await rows(C, "SELECT 1 FROM holdings WHERE owner_id = $1", [C]);
    expect(r).toHaveLength(1);
  });

  it("converts percent to basis points exactly", () => {
    expect(percentToBps(24.99)).toBe(2499);
    expect(percentToBps(0)).toBe(0);
    expect(percentToBps(null)).toBeNull();
    expect(percentToBps(-1)).toBeNull();
  });
});

describe("owner isolation", () => {
  it("a second owner never sees the first owner's synced rows", async () => {
    const itemId = await seedItem(ctx, D, "pi-iso", [account("pa-iso")]);
    const { plaid } = pagedPlaid([page({ added: [txn("ti1", "pa-iso", 7)], nextCursor: "i1" })]);
    plaid.getAccounts = vi.fn(async () => [accountInfo("pa-iso")]);
    await svc(plaid).syncItem(D, itemId);

    for (const table of ["transactions", "accounts", "items", "liabilities", "holdings", "securities", "balance_snapshots", "net_worth_daily"]) {
      const seenByB = await rows(B, `SELECT 1 FROM ${table}`);
      expect(seenByB, table).toHaveLength(0);
    }
    expect((await rows(D, "SELECT 1 FROM transactions WHERE plaid_transaction_id = 'ti1'")).length).toBe(1);
    // B cannot sync A's Item either: it does not exist from B's point of view.
    const r = await svc(fakePlaid()).syncItem(B, itemId);
    expect(r.balances).toEqual({ ok: false, code: "ITEM_NOT_FOUND" });
  });

  it("the private lookups expose only owner ids", async () => {
    await seedItem(ctx, "owner-lookup", "pi-lookup", [account("pa-lookup")]);
    expect(await ctx.syncRepo.ownerForPlaidItem("pi-lookup")).toBe("owner-lookup");
    expect(await ctx.syncRepo.ownerForPlaidItem("pi-does-not-exist")).toBeNull();
    expect(await ctx.syncRepo.itemOwnerIds()).toContain("owner-lookup");
    // An unscoped session still reads no table data.
    const direct = await ctx.pg.query("SELECT 1 FROM items");
    expect(direct.rows).toHaveLength(0);
  });
});
