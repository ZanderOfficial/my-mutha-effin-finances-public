import { beforeAll, describe, expect, it } from "vitest";
import { addAccount, setupDb, type Ctx } from "@/server/reports/test-helpers";
import { makeItemFromSpending, matchSpending } from "./spending";

// Synthetic owners, merchants and amounts only; they exist in this file and nowhere else.
const A = "owner-spend-a";
const B = "owner-spend-b";
let ctx: Ctx;
let account: string;
let gym: string;
let seq = 0;

const rows = <T = Record<string, unknown>>(owner: string, sql: string, params: unknown[] = []) =>
  ctx.run(owner, async (tx) => (await tx.query<T & Record<string, unknown>>(sql, params)).rows);

async function spend(merchant: string, amount = -4000) {
  seq += 1;
  const r = await ctx.run(A, (tx) =>
    tx.query<{ id: string }>(
      `INSERT INTO transactions (owner_id, account_id, plaid_transaction_id, amount_cents, date, name, merchant)
       VALUES ($1, $2, $3, $4, '2026-10-05', $5, $5) RETURNING id`,
      [A, account, `tx-spend-${seq}`, amount, merchant],
    ),
  );
  return r.rows[0].id;
}

const none = { sourceKey: "", always: false, transactionIds: [] as unknown[] };

beforeAll(async () => {
  ctx = await setupDb();
  account = await addAccount(ctx, A, "item-spend-a", "acct-spend-a");
  gym = (
    await rows<{ id: string }>(A, "INSERT INTO planned_items (owner_id, name, amount_cents, frequency) VALUES ($1, 'Gym', 4000, 'monthly') RETURNING id", [A])
  )[0].id;
});

describe("matching spending", () => {
  it("makes a spending rule for a merchant that leaves its deposit rule alone", async () => {
    await spend("Fitness Place");
    await ctx.run(A, (tx) =>
      tx.query("INSERT INTO transaction_rules (owner_id, scope, source_key, kind) VALUES ($1, 'deposit', 'fitness place', 'not_income')", [A]),
    );
    const result = await matchSpending(ctx.run, A, { ...none, sourceKey: "fitness place", always: true, target: gym, businessId: "", taxCategoryId: "" });
    expect(result).toEqual({ ok: true });
    const saved = await rows(A, "SELECT scope, kind, planned_item_id FROM transaction_rules WHERE source_key = 'fitness place' ORDER BY scope");
    expect(saved).toEqual([
      { scope: "deposit", kind: "not_income", planned_item_id: null },
      { scope: "spending", kind: "planned_item", planned_item_id: gym },
    ]);
  });

  it("decides only the ticked transactions out of budget, with a tag, when Always is unticked", async () => {
    const one = await spend("Corner Shop");
    const other = await spend("Corner Shop");
    const result = await matchSpending(ctx.run, A, { ...none, transactionIds: [one], target: "out", businessId: "", taxCategoryId: "" });
    expect(result).toEqual({ ok: true });
    expect(await rows(A, "SELECT kind FROM transaction_choices WHERE transaction_id = $1", [one])).toEqual([{ kind: "out_of_budget" }]);
    expect(await rows(A, "SELECT 1 FROM transaction_choices WHERE transaction_id = $1", [other])).toEqual([]);
  });

  it("refuses a deposit, an unknown line item, and an empty pick", async () => {
    const refund = await spend("Corner Shop", 1500);
    expect(await matchSpending(ctx.run, A, { ...none, transactionIds: [refund], target: gym, businessId: "", taxCategoryId: "" })).toEqual({
      ok: false,
      message: "Only your own spending can be matched to the budget.",
    });
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await matchSpending(ctx.run, A, { ...none, sourceKey: "corner shop", always: true, target: unknown, businessId: "", taxCategoryId: "" })).ok).toBe(false);
    expect((await matchSpending(ctx.run, A, { ...none, target: gym, businessId: "", taxCategoryId: "" })).ok).toBe(false);
  });

  it("makes a new line item from a merchant and matches it, or writes nothing when refused", async () => {
    await spend("Stream Co", -1599);
    const made = await makeItemFromSpending(ctx.run, A, {
      ...none,
      sourceKey: "stream co",
      always: true,
      name: "Streaming",
      amount: "15.99",
      frequency: "monthly",
      notes: "",
      taxCategoryId: "",
      businessIds: [],
    });
    expect(made).toEqual({ ok: true });
    const [rule] = await rows<{ name: string; amount_cents: number }>(
      A,
      `SELECT i.name, i.amount_cents FROM transaction_rules r JOIN planned_items i ON i.id = r.planned_item_id WHERE r.source_key = 'stream co'`,
    );
    expect(rule).toEqual({ name: "Streaming", amount_cents: 1599 });

    const refused = await makeItemFromSpending(ctx.run, A, {
      ...none,
      sourceKey: "never seen",
      always: true,
      name: "Ghost",
      amount: "1",
      frequency: "monthly",
      notes: "",
      taxCategoryId: "",
      businessIds: [],
    });
    expect(refused.ok).toBe(false);
    expect(await rows(A, "SELECT 1 FROM planned_items WHERE name = 'Ghost'")).toEqual([]);
  });

  it("keeps a line item's For tag and tax category when a charge moves out of budget with no tags sent", async () => {
    const [studio] = await rows<{ id: string }>(A, "INSERT INTO businesses (owner_id, name) VALUES ($1, 'Studio') RETURNING id", [A]);
    const [supplies] = await rows<{ id: string }>(A, "INSERT INTO tax_categories (owner_id, name) VALUES ($1, 'Supplies') RETURNING id", [A]);
    const [kit] = await rows<{ id: string }>(
      A,
      "INSERT INTO planned_items (owner_id, name, amount_cents, frequency, tax_category_id) VALUES ($1, 'Kit', 2000, 'monthly', $2) RETURNING id",
      [A, supplies.id],
    );
    await rows(A, "INSERT INTO planned_item_businesses (owner_id, item_id, business_id) VALUES ($1, $2, $3)", [A, kit.id, studio.id]);
    const charge = await spend("Kit Shop");
    await matchSpending(ctx.run, A, { ...none, sourceKey: "kit shop", always: true, target: kit.id, businessId: "", taxCategoryId: "" });

    // MatchRows posts only the transaction and the target: the form's tag fields are absent (null).
    const moved = await matchSpending(ctx.run, A, { ...none, transactionIds: [charge], target: "out", businessId: null, taxCategoryId: null });
    expect(moved).toEqual({ ok: true });
    const tagsOf = () => rows(A, "SELECT kind, business_id, tax_category_id FROM transaction_choices WHERE transaction_id = $1", [charge]);
    expect(await tagsOf()).toEqual([{ kind: "out_of_budget", business_id: studio.id, tax_category_id: supplies.id }]);

    // Moved out again with no tags sent, it keeps its own; "" still means None.
    await matchSpending(ctx.run, A, { ...none, transactionIds: [charge], target: "out", businessId: null, taxCategoryId: null });
    expect(await tagsOf()).toEqual([{ kind: "out_of_budget", business_id: studio.id, tax_category_id: supplies.id }]);
    await matchSpending(ctx.run, A, { ...none, transactionIds: [charge], target: "out", businessId: "", taxCategoryId: null });
    expect(await tagsOf()).toEqual([{ kind: "out_of_budget", business_id: null, tax_category_id: supplies.id }]);
  });

  it("keeps a merchant rule's tags when the rule moves out of budget with no tags sent", async () => {
    const [cafe] = await rows<{ id: string }>(A, "INSERT INTO businesses (owner_id, name) VALUES ($1, 'Cafe') RETURNING id", [A]);
    await spend("Bean Stop");
    await matchSpending(ctx.run, A, { ...none, sourceKey: "bean stop", always: true, target: "out", businessId: cafe.id, taxCategoryId: "" });
    await matchSpending(ctx.run, A, { ...none, sourceKey: "bean stop", always: true, target: "out", businessId: null, taxCategoryId: null });
    expect(await rows(A, "SELECT business_id FROM transaction_rules WHERE scope = 'spending' AND source_key = 'bean stop'")).toEqual([
      { business_id: cafe.id },
    ]);
  });

  it("drops a rule and its choices back to Misc when their line item is deleted", async () => {
    await ctx.run(A, (tx) => tx.query("DELETE FROM planned_items WHERE id = $1", [gym]));
    expect(await rows(A, "SELECT 1 FROM transaction_rules WHERE scope = 'spending' AND source_key = 'fitness place'")).toEqual([]);
  });

  it("lets another owner see and use none of it", async () => {
    expect(await rows(B, "SELECT 1 FROM transaction_rules")).toEqual([]);
    const theirs = (await rows<{ id: string }>(A, "SELECT id FROM transactions WHERE merchant = 'Corner Shop' AND amount_cents < 0 LIMIT 1"))[0].id;
    expect((await matchSpending(ctx.run, B, { ...none, transactionIds: [theirs], target: "out", businessId: "", taxCategoryId: "" })).ok).toBe(false);
  });
});
