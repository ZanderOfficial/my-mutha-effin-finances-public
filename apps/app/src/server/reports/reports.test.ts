import { beforeAll, describe, expect, it } from "vitest";
import { FLOW_EXCLUSION_SQL, depositStatus, depositStatusSql, isFlowExcluded, isOwnTransfer, ownTransferSql } from "@/lib/flow";
import { monthWindow } from "@/lib/month";
import { loadCatchUp, loadMiscCount, loadPlanned, type PlannedTab } from "./planned-loader";
import {
  loadIncome,
  loadNetWorth,
  loadOverview,
  loadTransactions,
} from "./loaders";
import {
  escapeLike,
  readAccounts,
  readDebts,
  readDepositsForYear,
  readHoldings,
  readItems,
  readLatestNetWorth,
  readLatestTransactions,
  readMonthFlow,
  readNetWorthSeries,
  readTransactionsPage,
} from "./repository";
import { readBusinesses, readHandSorted, readSourceRules, readUnsortedDeposits } from "./income";
import { readPlannedItems, readScheduleCForm, readTaxCategories } from "./planned";
import {
  addAccount,
  addNetWorthDay,
  addTx,
  depsFor,
  setupDb,
  type Ctx,
} from "./test-helpers";

// Every owner id, name and amount below is synthetic and exists only here.
const A = "owner-a-test";
const B = "owner-b-test";
const W = monthWindow("2026-06-13");

let ctx: Ctx;
let checking: string;
let card: string;

beforeAll(async () => {
  ctx = await setupDb();
  checking = await addAccount(ctx, A, "item-a1", "acct-a-checking", { name: "Checking" });
  card = await addAccount(ctx, A, "item-a2", "acct-a-card", {
    name: "Card",
    type: "credit",
    subtype: "credit card",
    isLiability: true,
    balanceCents: 120000,
    limitCents: 500000,
  });
  const tx = (amount: number, date: string, over = {}) =>
    addTx(ctx, A, checking, { amount, date, ...over });

  await tx(300000, "2026-06-02", { category: "INCOME", name: "Pay" });
  await tx(5000, "2026-06-12", { category: "INCOME", pending: true });
  await tx(-10000, "2026-06-03", { merchant: "Corner Cafe", name: "CAFE 1" });
  await tx(-2500, "2026-06-12", { pending: true });
  await tx(-40000, "2026-06-05", {
    category: "LOAN_PAYMENTS",
    detail: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
  });
  await tx(-50000, "2026-06-06", { category: "TRANSFER_OUT" });
  await tx(50000, "2026-06-06", { category: "TRANSFER_IN" });
  await tx(-7000, "2026-06-07", { category: null });
  await tx(-9999, "2026-06-08", { removed: true });
  await tx(-30000, "2026-06-09", { category: "LOAN_PAYMENTS", detail: "LOAN_PAYMENTS_CAR_PAYMENT" });
  await tx(-20000, "2026-05-10"); // inside "the same days last month"
  await tx(-80000, "2026-05-20"); // after day 13, outside it

  await addNetWorthDay(ctx, A, "2026-01-01", 100000, 0);
  await addNetWorthDay(ctx, A, "2026-05-20", 200000, 50000);
  await addNetWorthDay(ctx, A, "2026-06-12", 250000, 50000, true);

  await ctx.run(A, async (t) => {
    await t.query(`INSERT INTO budgets (owner_id, category, limit_cents) VALUES ($1, 'FOOD_AND_DRINK', 15000)`, [A]);
    const sec = await t.query<{ id: string }>(
      `INSERT INTO securities (owner_id, plaid_security_id, name, ticker, type)
       VALUES ($1, 'sec-1', 'Fund One', 'FND1', 'etf'), ($1, 'sec-2', 'Share Two', NULL, 'equity'),
              ($1, 'sec-3', 'Mystery', NULL, NULL) RETURNING id`,
      [A],
    );
    const vals = [30000, 10000, null];
    for (const [i, s] of sec.rows.entries()) {
      await t.query(
        `INSERT INTO holdings (owner_id, account_id, security_id, quantity, institution_value_cents)
         VALUES ($1, $2, $3, 1, $4)`,
        [A, checking, s.id, vals[i]],
      );
    }
    await t.query(
      `INSERT INTO liabilities (owner_id, account_id, kind, next_due_date, min_payment_cents)
       VALUES ($1, $2, 'credit', '2026-06-25', 3500)`,
      [A, card],
    );
  });

  const other = await addAccount(ctx, B, "item-b", "acct-b", { name: "Other" });
  await addTx(ctx, B, other, { amount: -123456, date: "2026-06-04" });
  await addNetWorthDay(ctx, B, "2026-06-12", 999900, 0);
  await ctx.run(B, (t) =>
    t.query(`INSERT INTO budgets (owner_id, category, limit_cents) VALUES ($1, 'TRAVEL', 100)`, [B]),
  );
});

describe("month flow", () => {
  it("sums income and spending, excluding transfers, card payments and removed rows", async () => {
    const f = await ctx.run(A, (tx) => readMonthFlow(tx, A, W));
    expect(f).toEqual({
      dataKnown: true,
      incomeCents: 305000, // 300000 + 5000 pending; the 50000 TRANSFER_IN is out
      spendingCents: 49500, // 10000 + 2500 pending + 7000 uncategorised + 30000 car loan
      pendingCount: 2,
      unsortedCount: 1, // the TRANSFER_IN deposit, which no rule covers yet
      prevSpendingCents: 20000, // only the May row on or before the 13th
    });
  });

  it("counts a deposit the owner marked as income, and honours a choice over a rule", async () => {
    const owner = "owner-income-flow";
    const account = await addAccount(ctx, owner, "item-income-flow", "acct-income-flow");
    await addTx(ctx, owner, account, { amount: 70000, date: "2026-06-03", category: "TRANSFER_IN", name: "CLIENT A 0601" });
    await addTx(ctx, owner, account, { amount: 30000, date: "2026-06-04", category: "TRANSFER_IN", name: "CLIENT A 0604" });
    await addTx(ctx, owner, account, { amount: 9000, date: "2026-06-05", category: "TRANSFER_IN", name: "SAVINGS" });
    await addTx(ctx, owner, account, {
      amount: 40000,
      date: "2026-06-06",
      category: "LOAN_PAYMENTS",
      detail: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    });
    const flow = () => ctx.run(owner, (tx) => readMonthFlow(tx, owner, W));
    expect(await flow()).toMatchObject({ incomeCents: 0, unsortedCount: 3 });

    await ctx.run(owner, async (tx) => {
      await tx.query(
        `INSERT INTO transaction_rules (owner_id, source_key, kind) VALUES ($1, 'client a', 'income')`,
        [owner],
      );
      await tx.query(
        `INSERT INTO transaction_choices (owner_id, transaction_id, kind)
         SELECT $1, id, 'not_income' FROM transactions WHERE name = 'CLIENT A 0604'`,
        [owner],
      );
    });
    expect(await flow()).toMatchObject({ incomeCents: 70000, unsortedCount: 1 });
  });

  it("reads a year of deposits with their status, business and the start of history", async () => {
    const owner = "owner-income-flow";
    const year = await ctx.run(owner, (tx) => readDepositsForYear(tx, owner, 2026));
    expect(year.historyStart).toBe("2026-06-03");
    expect(year.deposits.map((d) => [d.date, d.amountCents, d.status])).toEqual([
      ["2026-06-03", 70000, "income"],
      ["2026-06-04", 30000, "not_income"],
      ["2026-06-05", 9000, "unsorted"],
    ]);
    expect(await ctx.run(B, (tx) => readDepositsForYear(tx, B, 2026))).toMatchObject({ deposits: [] });
  });

  it("agrees with the JavaScript exclusion rule over a matrix of categories", async () => {
    const cats = [null, "FOOD_AND_DRINK", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"];
    const details = [null, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "LOAN_PAYMENTS_CAR_PAYMENT", "X"];
    const probe = await ctx.run(A, async (tx) => {
      const out: { c: string | null; d: string | null; sql: boolean }[] = [];
      for (const c of cats)
        for (const d of details) {
          const r = await tx.query<{ x: boolean }>(
            `SELECT ${FLOW_EXCLUSION_SQL} AS x FROM (SELECT $1::text AS category, $2::text AS category_detail) q`,
            [c, d],
          );
          out.push({ c, d, sql: r.rows[0].x });
        }
      return out;
    });
    expect(probe).toHaveLength(20);
    for (const p of probe) {
      expect(p.sql).toBe(isFlowExcluded({ category: p.c, categoryDetail: p.d }));
    }
  });

  it("agrees with the JavaScript deposit rule over a matrix of cases", async () => {
    const amounts = [1000, -1000];
    const cats = [null, "INCOME", "TRANSFER_IN"];
    const details = [null, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"];
    const ruleKinds = [null, "income", "not_income"];
    // Budget choices (M9) sit on spending and must never change a deposit's status.
    const choiceKinds = [...ruleKinds, "planned_item", "out_of_budget"];
    const probe = await ctx.run(A, async (tx) => {
      const out: { a: number; c: string | null; d: string | null; ck: string | null; rk: string | null; own: boolean; sql: string }[] = [];
      for (const a of amounts)
        for (const c of cats)
          for (const d of details)
            for (const ck of choiceKinds)
              for (const rk of ruleKinds)
                for (const own of [false, true]) {
                  const r = await tx.query<{ s: string }>(
                    `SELECT ${depositStatusSql("$6::boolean")} AS s
                       FROM (SELECT $1::bigint AS amount_cents, $2::text AS category, $3::text AS category_detail) t,
                            (SELECT $4::text AS kind) c, (SELECT $5::text AS kind) r`,
                    [a, c, d, ck, rk, own],
                  );
                  out.push({ a, c, d, ck, rk, own, sql: r.rows[0].s });
                }
      return out;
    });
    expect(probe).toHaveLength(360);
    for (const p of probe) {
      expect(p.sql).toBe(
        depositStatus({ amountCents: p.a, category: p.c, categoryDetail: p.d, choiceKind: p.ck, ruleKind: p.rk, ownTransfer: p.own }),
      );
    }
  });

  it("pairs own-account transfers in SQL exactly as the JavaScript rule does, and never across owners", async () => {
    const owner = "owner-own-transfers";
    const checking = await addAccount(ctx, owner, "item-own-1", "acct-own-checking");
    const savings = await addAccount(ctx, owner, "item-own-2", "acct-own-savings");
    const rows: [string, number, string][] = [
      [checking, -50000, "2026-10-01"], [savings, 50000, "2026-10-03"], // paired, 2 days apart
      [checking, -7000, "2026-10-01"], [savings, 7000, "2026-10-05"], // 4 days apart: not paired
      [checking, -900, "2026-10-02"], [checking, 900, "2026-10-02"], // same account: not paired
      [savings, 1234, "2026-10-04"], // a client's payment with no other half
    ];
    for (const [account, amount, date] of rows) await addTx(ctx, owner, account, { amount, date, category: "TRANSFER_IN" });
    // Another owner's matching withdrawal must not pair with this owner's deposit.
    const stranger = await addAccount(ctx, "owner-own-stranger", "item-own-3", "acct-own-stranger");
    await addTx(ctx, "owner-own-stranger", stranger, { amount: -1234, date: "2026-10-04" });

    const read = await ctx.run(owner, (tx) =>
      tx.query<{ id: string; account_id: string; amount_cents: string; date: string; own: boolean }>(
        `SELECT t.id, t.account_id, t.amount_cents, to_char(t.date, 'YYYY-MM-DD') AS date, ${ownTransferSql("t")} AS own
           FROM transactions t WHERE t.owner_id = $1`,
        [owner],
      ),
    );
    const all = read.rows.map((r) => ({ id: r.id, accountId: r.account_id, amountCents: Number(r.amount_cents), date: r.date }));
    expect(read.rows.filter((r) => r.own).map((r) => Number(r.amount_cents)).sort((a, b) => a - b)).toEqual([-50000, 50000]);
    read.rows.forEach((r, i) => expect(r.own).toBe(isOwnTransfer(all[i], all)));
  });

  it("keeps a payee the owner marked a transfer out of spending, and tags it in the Transactions list", async () => {
    const owner = "owner-marked-transfer";
    const checking = await addAccount(ctx, owner, "item-marked-1", "acct-marked-1");
    await addTx(ctx, owner, checking, { amount: -242300, date: "2026-06-08", name: "To Credit Union", merchant: "To Credit Union", category: "LOAN_PAYMENTS" });
    await addTx(ctx, owner, checking, { amount: -1000, date: "2026-06-09", name: "Cafe", merchant: "Cafe" });
    await ctx.run(owner, (tx) =>
      tx.query("INSERT INTO transaction_rules (owner_id, scope, source_key, kind) VALUES ($1, 'spending', 'to credit union', 'transfer')", [owner]),
    );
    const o = await loadOverview(depsFor(ctx, owner, { now: () => new Date("2026-06-20T12:00:00Z") }));
    expect(o.flow.spendingCents).toBe(1000);
    const list = await ctx.run(owner, (tx) => readTransactionsPage(tx, owner, { flow: "all", q: "", page: 1, pageSize: 50 }));
    expect(list.rows.find((row) => row.name === "To Credit Union")?.excluded).toBe(true);
    expect(list.rows.find((row) => row.name === "Cafe")?.excluded).toBe(false);
  });

  it("keeps a paired deposit out of income and Unsorted, and a paired withdrawal out of spending", async () => {
    const owner = "owner-own-flow";
    const checking = await addAccount(ctx, owner, "item-own-4", "acct-own-flow-1");
    const savings = await addAccount(ctx, owner, "item-own-5", "acct-own-flow-2");
    await addTx(ctx, owner, checking, { amount: -30000, date: "2026-06-02", category: "GENERAL_SERVICES" });
    await addTx(ctx, owner, savings, { amount: 30000, date: "2026-06-03", category: "INCOME" });
    await addTx(ctx, owner, savings, { amount: 4000, date: "2026-06-04", category: "TRANSFER_IN" });
    const o = await loadOverview(depsFor(ctx, owner, { now: () => new Date("2026-06-20T12:00:00Z") }));
    expect(o.flow).toMatchObject({ incomeCents: 0, spendingCents: 0, unsortedCount: 1 });
  });

  it("ignores a spending rule when sorting the same source's deposits", async () => {
    const owner = "owner-income-flow";
    await ctx.run(owner, async (tx) => {
      const item = await tx.query<{ id: string }>(
        `INSERT INTO planned_items (owner_id, name, amount_cents, frequency) VALUES ($1, 'Savings', 100, 'monthly') RETURNING id`,
        [owner],
      );
      await tx.query(
        `INSERT INTO transaction_rules (owner_id, scope, source_key, kind, planned_item_id) VALUES ($1, 'spending', 'savings', 'planned_item', $2)`,
        [owner, item.rows[0].id],
      );
    });
    const year = await ctx.run(owner, (tx) => readDepositsForYear(tx, owner, 2026));
    expect(year.deposits.find((d) => d.label === "SAVINGS")?.status).toBe("unsorted");
  });
});

describe("transactions", () => {
  const page = (o: Partial<Parameters<typeof readTransactionsPage>[2]> = {}) =>
    ctx.run(A, (tx) =>
      readTransactionsPage(tx, A, { flow: "all", q: "", page: 1, pageSize: 50, ...o }),
    );

  it("lists everything except removed rows, newest first, flagging uncounted rows", async () => {
    const { rows, total } = await page();
    expect(total).toBe(11);
    expect(rows[0].date >= rows[1].date).toBe(true);
    expect(rows.find((r) => r.amountCents === -40000)?.excluded).toBe(true);
    expect(rows.find((r) => r.amountCents === -10000)?.excluded).toBe(false);
    expect(rows.find((r) => r.amountCents === -9999)).toBeUndefined();
    expect(rows.every((r) => r.accountName === "Checking")).toBe(true);
  });

  it("filters by direction", async () => {
    expect((await page({ flow: "income" })).rows.every((r) => r.amountCents > 0)).toBe(true);
    expect((await page({ flow: "spending" })).rows.every((r) => r.amountCents < 0)).toBe(true);
    expect((await page({ flow: "income" })).total).toBe(3);
  });

  it("searches merchant and name, case-insensitively, as data not as SQL", async () => {
    expect((await page({ q: "corner" })).total).toBe(1);
    expect((await page({ q: "cafe 1" })).total).toBe(1);
    expect((await page({ q: "'; DROP TABLE transactions; --" })).total).toBe(0);
    expect((await page()).total).toBe(11);
  });

  it("treats % and _ in a search as literal characters", async () => {
    expect((await page({ q: "%" })).total).toBe(0);
    expect((await page({ q: "_" })).total).toBe(0);
    expect(escapeLike("50%_\\")).toBe("50\\%\\_\\\\");
  });

  it("pages by the page size with a stable order", async () => {
    const p1 = await page({ pageSize: 4, page: 1 });
    const p2 = await page({ pageSize: 4, page: 2 });
    const p3 = await page({ pageSize: 4, page: 3 });
    expect([p1.rows.length, p2.rows.length, p3.rows.length]).toEqual([4, 4, 3]);
    const ids = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(11);
    expect(p3.total).toBe(11);
  });

  it("returns the latest few", async () => {
    const rows = await ctx.run(A, (tx) => readLatestTransactions(tx, A, 3));
    expect(rows).toHaveLength(3);
    expect(rows[0].date).toBe("2026-06-12");
  });
});

describe("net worth, accounts, holdings, debts", () => {
  it("reads the latest row and a series from a start date", async () => {
    const latest = await ctx.run(A, (tx) => readLatestNetWorth(tx, A));
    expect(latest).toMatchObject({
      date: "2026-06-12",
      netWorthCents: 200000,
      assetsCents: 250000,
      liabilitiesCents: 50000,
      incomplete: true,
    });
    expect(
      (await ctx.run(A, (tx) => readNetWorthSeries(tx, A, "2026-05-01"))).map((d) => d.date),
    ).toEqual(["2026-05-20", "2026-06-12"]);
    expect((await ctx.run(A, (tx) => readNetWorthSeries(tx, A, null))).length).toBe(3);
  });

  it("returns accounts with their institution, liabilities flagged", async () => {
    const accounts = await ctx.run(A, (tx) => readAccounts(tx, A));
    expect(accounts.map((a) => [a.name, a.isLiability, a.balanceCents])).toEqual([
      ["Card", true, 120000],
      ["Checking", false, 10000],
    ]);
  });

  it("reads holdings, keeping an unknown value unknown", async () => {
    const h = await ctx.run(A, (tx) => readHoldings(tx, A));
    expect(h.map((x) => [x.name, x.valueCents])).toEqual([
      ["Fund One", 30000],
      ["Mystery", null],
      ["Share Two", 10000],
    ]);
  });

  it("reads debts with limit, due date and minimum payment", async () => {
    const d = await ctx.run(A, (tx) => readDebts(tx, A));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      name: "Card",
      balanceCents: 120000,
      limitCents: 500000,
      nextDueDate: "2026-06-25",
      minPaymentCents: 3500,
    });
  });

  it("reads a loan's kind, rate, payoff and end date for the Debts view", async () => {
    const owner = "owner-loan-debts";
    const loan = await addAccount(ctx, owner, "item-loan", "acct-loan", {
      name: "Auto Loan",
      type: "loan",
      subtype: "auto",
      isLiability: true,
      balanceCents: 1200000,
    });
    await ctx.run(owner, (t) =>
      t.query(
        `INSERT INTO liabilities (owner_id, account_id, kind, next_due_date, min_payment_cents,
                                  apr_bps, apr_type, payoff_cents, maturity_date,
                                  last_payment_cents, last_payment_date)
         VALUES ($1, $2, 'loan', '2026-06-15', 28400, 649, 'fixed', 1234567, '2029-03-15', 28400, '2026-05-15')`,
        [owner, loan],
      ),
    );
    const d = await ctx.run(owner, (tx) => readDebts(tx, owner));
    expect(d[0]).toMatchObject({
      kind: "loan",
      subtype: "auto",
      limitCents: null,
      nextDueDate: "2026-06-15",
      minPaymentCents: 28400,
      aprBps: 649,
      aprType: "fixed",
      payoffCents: 1234567,
      maturityDate: "2029-03-15",
      lastPaymentCents: 28400,
      lastPaymentDate: "2026-05-15",
    });
    // A card without these details reads them as unknown, not zero.
    const card = (await ctx.run(A, (tx) => readDebts(tx, A)))[0];
    expect(card).toMatchObject({ kind: "credit", payoffCents: null, maturityDate: null, aprBps: null });
  });

  it("reads items", async () => {
    expect((await ctx.run(A, (tx) => readItems(tx, A))).map((i) => i.status)).toEqual([
      "active",
      "active",
    ]);
  });
});

describe("owner isolation", () => {
  it("shows a second owner only their own rows", async () => {
    const f = await ctx.run(B, (tx) => readMonthFlow(tx, B, W));
    expect(f.incomeCents).toBe(0);
    expect(f.spendingCents).toBe(123456);
    expect((await ctx.run(B, (tx) => readAccounts(tx, B))).map((a) => a.name)).toEqual(["Other"]);
    expect(await ctx.run(B, (tx) => readHoldings(tx, B))).toEqual([]);
    expect(await ctx.run(B, (tx) => readDebts(tx, B))).toEqual([]);
  });

  it("shows a stranger nothing at all", async () => {
    const C = "owner-c-test";
    const f = await ctx.run(C, (tx) => readMonthFlow(tx, C, W));
    expect(f.dataKnown).toBe(false);
    expect(await ctx.run(C, (tx) => readLatestNetWorth(tx, C))).toBeNull();
    expect(await ctx.run(C, (tx) => readLatestTransactions(tx, C, 5))).toEqual([]);
    // Even asking for the other owner's id in the WHERE clause returns nothing.
    expect(await ctx.run(C, (tx) => readLatestTransactions(tx, A, 5))).toEqual([]);
    expect(await ctx.run(C, (tx) => readTransactionsPage(tx, A, {
      flow: "all", q: "", page: 1, pageSize: 50,
    }))).toEqual({ rows: [], total: 0 });
  });
});

describe("loaders", () => {
  it("overview combines the real rows", async () => {
    const o = await loadOverview(depsFor(ctx, A));
    expect(o.window?.today).toBe("2026-06-13");
    expect(o.flow.incomeCents).toBe(305000);
    expect(o.gapCents).toBe(305000 - 49500);
    expect(o.netWorth?.netWorthCents).toBe(200000);
    expect(o.series.map((p) => p.date)).toEqual(["2026-05-20", "2026-06-12"]);
    expect(o.latest).toHaveLength(5);
    expect(o.linkedCount).toBe(2);
    expect(o.attention).toEqual([]);
  });

  it("overview lists items that need attention", async () => {
    const c = await setupDb();
    await addAccount(c, A, "item-x", "acct-x", {}, "needs_reauth");
    const o = await loadOverview(depsFor(c, A));
    expect(o.attention.map((i) => i.status)).toEqual(["needs_reauth"]);
    expect(o.flow.dataKnown).toBe(false);
    expect(o.flow.incomeCents).toBeNull();
    expect(o.gapCents).toBeNull();
  });

  it("uses the owner's time zone for the month", async () => {
    // 03:00 UTC on 1 July is still 30 June in Los Angeles.
    const o = await loadOverview(
      depsFor(ctx, A, {
        now: () => new Date("2026-07-01T03:00:00Z"),
        timezone: () => "America/Los_Angeles",
      }),
    );
    expect(o.window?.today).toBe("2026-06-30");
    expect(o.window?.daysLeft).toBe(0);
    expect(o.flow.incomeCents).toBe(305000);
    const utc = await loadOverview(depsFor(ctx, A, { now: () => new Date("2026-07-01T03:00:00Z") }));
    expect(utc.window?.today).toBe("2026-07-01");
    expect(utc.flow.incomeCents).toBe(0); // a real zero: data exists, none this month
  });

  it("transactions loader returns a page and total", async () => {
    const t = await loadTransactions(depsFor(ctx, A), { flow: "all", q: "", page: 1 });
    expect(t.total).toBe(11);
    expect(t.rows).toHaveLength(11);
  });

  it("net worth summary, investments and debts views", async () => {
    const s = await loadNetWorth(depsFor(ctx, A), "summary", "All");
    expect(s.series).toHaveLength(3);
    expect(s.delta?.deltaCents).toBe(200000 - 100000);
    expect(s.assets.map((a) => a.name)).toEqual(["Checking"]);
    expect(s.liabilities.map((a) => a.name)).toEqual(["Card"]);

    const oneMonth = await loadNetWorth(depsFor(ctx, A), "summary", "1M");
    expect(oneMonth.series.map((p) => p.date)).toEqual(["2026-05-20", "2026-06-12"]);

    const inv = await loadNetWorth(depsFor(ctx, A), "investments", "6M");
    expect(inv.holdings.map((h) => [h.name, h.shareBps])).toEqual([
      ["Fund One", 7500],
      ["Share Two", 2500],
      ["Mystery", null],
    ]);
    expect(inv.slices.map((x) => x.label)).toEqual(["ETF", "Equity"]);

    const debts = await loadNetWorth(depsFor(ctx, A), "debts", "6M");
    expect(debts.debts).toHaveLength(1);
  });
});

describe("income tab", () => {
  const owner = "owner-income-tab";
  let studio: string;

  beforeAll(async () => {
    const account = await addAccount(ctx, owner, "item-income-tab", "acct-income-tab");
    const deposit = (amount: number, date: string, name: string, category: string | null = "TRANSFER_IN") =>
      addTx(ctx, owner, account, { amount, date, name, category });
    await deposit(50000, "2025-11-03", "CLIENT A 1103");
    await deposit(120000, "2026-01-15", "PAYROLL", "INCOME");
    await deposit(70000, "2026-02-03", "CLIENT A 0203");
    await deposit(30000, "2026-06-02", "CLIENT A 0602");
    await deposit(9000, "2026-06-04", "MOBILE DEPOSIT 0604");
    await deposit(4000, "2026-06-05", "MOBILE DEPOSIT 0605");
    await addTx(ctx, owner, account, {
      amount: 40000,
      date: "2026-06-06",
      category: "LOAN_PAYMENTS",
      detail: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    });
    await ctx.run(owner, async (tx) => {
      const business = await tx.query<{ id: string }>(
        `INSERT INTO businesses (owner_id, name) VALUES ($1, 'Studio') RETURNING id`,
        [owner],
      );
      studio = business.rows[0].id;
      await tx.query(
        `INSERT INTO transaction_rules (owner_id, source_key, kind, business_id) VALUES ($1, 'client a', 'income', $2)`,
        [owner, studio],
      );
      await tx.query(
        `INSERT INTO transaction_choices (owner_id, transaction_id, kind)
         SELECT $1, id, 'not_income' FROM transactions WHERE name = 'MOBILE DEPOSIT 0605'`,
        [owner],
      );
    });
  });

  it("lists only the deposits nothing has decided, with their source", async () => {
    const unsorted = await ctx.run(owner, (tx) => readUnsortedDeposits(tx, owner));
    expect(unsorted.map((d) => [d.date, d.amountCents, d.sourceKey])).toEqual([
      ["2026-06-04", 9000, "mobile deposit"],
    ]);
  });

  it("reads rules with a label, business and deposit count, and the year's hand-sorted deposits", async () => {
    const rules = await ctx.run(owner, (tx) => readSourceRules(tx, owner));
    expect(rules).toMatchObject([
      { sourceKey: "client a", label: "CLIENT A 0602", kind: "income", businessName: "Studio", depositCount: 3 },
    ]);
    const handSorted = await ctx.run(owner, (tx) => readHandSorted(tx, owner, 2026));
    expect(handSorted).toMatchObject([{ date: "2026-06-05", amountCents: 4000, kind: "not_income" }]);
    expect(await ctx.run(owner, (tx) => readHandSorted(tx, owner, 2025))).toEqual([]);
    expect(await ctx.run(owner, (tx) => readBusinesses(tx, owner))).toEqual([{ id: studio, name: "Studio" }]);
  });

  it("shows a stranger none of it", async () => {
    const reads = await ctx.run(B, async (tx) => [
      await readUnsortedDeposits(tx, B),
      await readSourceRules(tx, B),
      await readHandSorted(tx, B, 2026),
      await readBusinesses(tx, B),
    ]);
    expect(reads).toEqual([[], [], [], []]);
  });

  it("loads a year, offers every synced year and falls back to this year", async () => {
    const deps = depsFor(ctx, owner);
    const thisYear = await loadIncome(deps, null);
    expect(thisYear).toMatchObject({ year: 2026, years: [2025, 2026], canEdit: true });
    expect(thisYear.income.months.map((m) => m.totalCents).slice(0, 7)).toEqual([
      120000, 70000, 0, 0, 0, 30000, null,
    ]);
    expect(thisYear.unsorted).toMatchObject([{ sourceKey: "mobile deposit", count: 1, totalCents: 9000 }]);
    expect((await loadIncome(deps, 2025)).income.totalCents).toBe(50000);
    expect((await loadIncome(deps, 1999)).year).toBe(2026);
  });

  it("agrees with the Overview on this month's income", async () => {
    const deps = depsFor(ctx, owner);
    const overview = await loadOverview(deps);
    const income = await loadIncome(deps, null);
    expect(income.income.months[5].totalCents).toBe(overview.flow.incomeCents);
    expect(income.income.months[5].unsortedCount).toBe(overview.flow.unsortedCount);
  });
});

describe("planned tabs", () => {
  const owner = "owner-planned-tab";
  let studio: string;

  beforeAll(async () => {
    await ctx.run(owner, async (tx) => {
      const insert = async (sql: string, params: unknown[]) =>
        (await tx.query<{ id: string }>(`${sql} RETURNING id`, [owner, ...params])).rows[0].id;
      studio = await insert("INSERT INTO businesses (owner_id, name) VALUES ($1, $2)", ["Studio"]);
      const software = await insert(
        `INSERT INTO tax_categories (owner_id, name, schedule_c_year, schedule_c_line, mapping_confirmed)
         VALUES ($1, $2, 2025, '18', true)`,
        ["Software"],
      );
      await insert("INSERT INTO tax_categories (owner_id, name, personal) VALUES ($1, $2, true)", ["Pets"]);
      await insert("INSERT INTO planned_items (owner_id, name, amount_cents, frequency) VALUES ($1, $2, 150000, 'monthly')", ["Rent"]);
      const hosting = await insert(
        "INSERT INTO planned_items (owner_id, name, amount_cents, frequency, tax_category_id) VALUES ($1, $2, 3000, 'monthly', $3)",
        ["Hosting", software],
      );
      await tx.query("INSERT INTO planned_item_businesses (owner_id, item_id, business_id) VALUES ($1, $2, $3)", [owner, hosting, studio]);
      await insert("INSERT INTO planned_items (owner_id, name, amount_cents, frequency) VALUES ($1, $2, 90000, 'annual')", ["Insurance"]);
    });
  });

  it("reads items with their tags, categories with their line, and the form's lines", async () => {
    const items = await ctx.run(owner, (tx) => readPlannedItems(tx, owner));
    const byName = items.map((i) => [i.name, i.amountCents, i.businessIds]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(byName).toEqual([
      ["Hosting", 3000, [studio]],
      ["Insurance", 90000, []],
      ["Rent", 150000, []],
    ]);
    const categories = await ctx.run(owner, (tx) => readTaxCategories(tx, owner));
    expect(categories.map((c) => [c.name, c.mapping.kind, c.line?.label ?? null])).toEqual([
      ["Pets", "personal", null],
      ["Software", "line", "Office expense (see instructions)"],
    ]);
    const form = await ctx.run(owner, (tx) => readScheduleCForm(tx));
    expect(form).toMatchObject({ year: 2025, sourceUrl: "https://www.irs.gov/pub/irs-pdf/f1040sc.pdf", checkedOn: "2026-10-09" });
    expect(form?.lines[0]).toEqual({ year: 2025, line: "8", heading: null, label: "Advertising" });
  });

  it("loads the Planned tab's totals in both views and by Schedule C line", async () => {
    const data = await loadPlanned(depsFor(ctx, owner), {
      tab: { kind: "planned", personalOnly: false },
      period: "monthly",
      by: "line",
    });
    expect(data).toMatchObject({ monthlyCents: 153000, annualCents: 90000, canEdit: true });
    expect(data.totals).toEqual([
      { label: "Not on a Schedule C line yet", totalCents: 150000, muted: true },
      { label: "Line 18 · Office expense (see instructions)", totalCents: 3000, muted: false },
    ]);
  });

  it("loads one business's tab, and falls back to Planned for a business that is gone", async () => {
    const query = (businessId: string) => ({ tab: { kind: "business" as const, businessId }, period: "monthly" as const, by: "category" as const });
    const business = await loadPlanned(depsFor(ctx, owner), query(studio));
    expect(business.budget.rows.map((r) => r.item.name)).toEqual(["Hosting"]);
    const gone = await loadPlanned(depsFor(ctx, owner), query("00000000-0000-4000-8000-000000000000"));
    expect(gone.tab).toEqual({ kind: "planned", personalOnly: false });
  });

  it("shows a stranger none of it", async () => {
    const reads = await ctx.run(B, async (tx) => [await readPlannedItems(tx, B), await readTaxCategories(tx, B)]);
    expect(reads).toEqual([[], []]);
  });

  it("checks real spending since the start date: a merchant rule, Misc and the badge count", async () => {
    const deps = depsFor(ctx, owner, { now: () => new Date("2026-10-20T12:00:00Z") });
    const query = { tab: { kind: "planned" as const, personalOnly: false }, period: "monthly" as const, by: "category" as const };
    expect((await loadPlanned(deps, query)).actuals.period).toBeNull(); // nothing synced yet: unknown, not zero

    const account = await addAccount(ctx, owner, "item-planned-tab", "acct-planned-tab");
    const spend = (amount: number, date: string, name: string) => addTx(ctx, owner, account, { amount, date, name, merchant: name });
    await spend(-150000, "2026-10-01", "Landlord");
    await spend(-2500, "2026-10-03", "Corner Cafe");
    await spend(-800, "2026-10-04", "Corner Cafe");
    await spend(-9900, "2026-09-20", "Corner Cafe"); // before the start date
    // None of these is sorted by the Landlord rule, so the rule's Charges count leaves them out.
    await spend(-150000, "2026-09-01", "Landlord"); // before the start date
    await addTx(ctx, owner, account, { amount: -5000, date: "2026-10-02", name: "Landlord", merchant: "Landlord", category: "TRANSFER_OUT" });
    await addTx(ctx, owner, account, { amount: -5000, date: "2026-10-02", name: "Landlord", merchant: "Landlord", removed: true });
    await ctx.run(owner, async (tx) => {
      await tx.query("INSERT INTO budget_settings (owner_id, start_date) VALUES ($1, '2026-10-01')", [owner]);
      await tx.query(
        `INSERT INTO transaction_rules (owner_id, scope, source_key, kind, planned_item_id)
         SELECT $1, 'spending', 'landlord', 'planned_item', id FROM planned_items WHERE name = 'Rent'`,
        [owner],
      );
    });

    const data = await loadPlanned(deps, query);
    const rent = data.allItems.find((i) => i.name === "Rent")!;
    expect(data.actuals.period).toEqual({ start: "2026-10-01", endExclusive: "2026-11-01" });
    expect(data.actuals.actualByItem[rent.id]).toBe(150000);
    expect(data.actuals.misc).toMatchObject([{ sourceKey: "corner cafe", count: 2, totalCents: 3300 }]);
    expect(data.startDate).toBe("2026-10-01");
    expect(data.spendingRules).toMatchObject([{ label: "Landlord", target: "Rent", spendingCount: 1 }]);
    expect(await loadMiscCount(deps)).toBe(2);
    expect(await loadMiscCount(depsFor(ctx, B))).toBeNull();

    // The one-time catch-up reaches back to January: the September cafe charge waits there, and
    // September shows what went out against nothing in.
    const catchUp = await loadCatchUp(deps);
    expect(catchUp.planned.actuals.misc).toMatchObject([{ sourceKey: "corner cafe", count: 3, totalCents: 13200 }]);
    expect(catchUp.flow?.months.find((m) => m.month === "2026-09")).toMatchObject({ madeCents: 0, spentCents: 159900, keptCents: -159900 });
    expect(await loadMiscCount(deps)).toBe(2); // the everyday Misc badge still starts at the start date
  });

  it("gives a business tab that business's income by month this year, and the Planned tab none", async () => {
    const deps = depsFor(ctx, owner, { now: () => new Date("2026-10-20T12:00:00Z") });
    const account = await addAccount(ctx, owner, "item-business-income", "acct-business-income");
    await addTx(ctx, owner, account, { amount: 80000, date: "2026-10-05", name: "Client Studio", merchant: "Client Studio", category: "TRANSFER_IN" });
    await addTx(ctx, owner, account, { amount: 1000, date: "2026-10-06", name: "Other Payer", merchant: "Other Payer", category: "TRANSFER_IN" });
    await ctx.run(owner, (tx) =>
      tx.query(
        `INSERT INTO transaction_choices (owner_id, transaction_id, kind, business_id)
         SELECT $1, id, 'income', CASE WHEN name = 'Client Studio' THEN $2::uuid END FROM transactions WHERE name IN ('Client Studio', 'Other Payer')`,
        [owner, studio],
      ),
    );
    const query = (tab: PlannedTab) => ({ tab, period: "monthly" as const, by: "category" as const });
    const business = await loadPlanned(deps, query({ kind: "business", businessId: studio }));
    expect(business.businessIncome?.year).toBe(2026);
    expect(business.businessIncome?.totalCents).toBe(80000);
    expect(business.businessIncome?.months.find((m) => m.month === "2026-10")).toMatchObject({ state: "partial", totalCents: 80000 });
    expect(business.businessIncome?.months.find((m) => m.month === "2026-11")?.totalCents).toBeNull();
    expect(business.madeCents).toBe(80000);
    const everything = await loadPlanned(deps, query({ kind: "planned", personalOnly: false }));
    expect(everything.businessIncome).toBeNull();
    expect(everything.madeCents).toBe(81000);
    expect((await loadPlanned(deps, query({ kind: "planned", personalOnly: true }))).madeCents).toBe(1000);
  });
});

describe("blank state: nothing invented", () => {
  it("every loader is blank with no owner, and never touches the database", async () => {
    let touched = false;
    const deps = depsFor(ctx, null, {
      run: async () => {
        touched = true;
        throw new Error("must not run");
      },
    });
    const o = await loadOverview(deps);
    expect(o).toMatchObject({
      window: null,
      gapCents: null,
      netWorth: null,
      series: [],
      latest: [],
      attention: [],
      linkedCount: null,
    });
    expect(o.flow).toEqual({
      dataKnown: false,
      incomeCents: null,
      spendingCents: null,
      pendingCount: 0,
      unsortedCount: 0,
      prevSpendingCents: null,
    });
    expect(o.standing).toMatchObject({ incomeCents: null, needCents: null, extrasCents: null, standingCents: null });
    const t = await loadTransactions(deps, { flow: "all", q: "", page: 1 });
    expect(t).toMatchObject({ rows: [], total: null });
    const n = await loadNetWorth(deps, "summary", "6M");
    expect(n).toMatchObject({ latest: null, series: [], delta: null, assets: [], liabilities: [] });
    const i = await loadIncome(deps, 2025);
    expect(i).toMatchObject({ year: 2026, years: [], unsorted: [], rules: [], businesses: [], canEdit: false });
    expect(i.income.totalCents).toBeNull();
    expect(i.income.months.every((m) => m.totalCents === null)).toBe(true);
    const p = await loadPlanned(deps, { tab: { kind: "planned", personalOnly: false }, period: "monthly", by: "category" });
    expect(p).toMatchObject({ monthlyCents: null, annualCents: null, totals: [], businesses: [], canEdit: false });
    expect(p.budget).toMatchObject({ rows: [], totalCents: null });
    expect(p.actuals).toMatchObject({ period: null, totalCents: null, misc: [] });
    expect(await loadMiscCount(deps)).toBeNull();
    expect(touched).toBe(false);
  });

  it("is blank when the database is not configured", async () => {
    const deps = depsFor(ctx, A, { configured: () => false });
    expect((await loadOverview(deps)).netWorth).toBeNull();
    expect((await loadPlanned(deps, { tab: { kind: "planned", personalOnly: false }, period: "monthly", by: "category" })).canEdit).toBe(false);
  });

  it("an owner with no rows gets nulls and empty lists, not zeros", async () => {
    const empty = await setupDb();
    const deps = depsFor(empty, "owner-new-test");
    const o = await loadOverview(deps);
    expect(o.flow.incomeCents).toBeNull();
    expect(o.flow.spendingCents).toBeNull();
    expect(o.flow.prevSpendingCents).toBeNull();
    expect(o.netWorth).toBeNull();
    expect(o.series).toEqual([]);
    expect(o.latest).toEqual([]);
    expect(o.linkedCount).toBe(0);

    expect(o.standing.standingCents).toBeNull();

    const t = await loadTransactions(deps, { flow: "all", q: "", page: 1 });
    expect(t.total).toBe(0);

    for (const view of ["summary", "investments", "debts"] as const) {
      const n = await loadNetWorth(deps, view, "All");
      expect(n.latest).toBeNull();
      expect(n.delta).toBeNull();
      expect([n.series, n.assets, n.liabilities, n.holdings, n.slices, n.debts]).toEqual([
        [], [], [], [], [], [],
      ]);
    }
  });
});
