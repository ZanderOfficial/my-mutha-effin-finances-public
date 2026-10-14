import { beforeAll, describe, expect, it } from "vitest";
import { addAccount, setupDb, type Ctx } from "@/server/reports/test-helpers";
import {
  addBusiness,
  removeBusiness,
  removeSourceRule,
  removeTransactionChoice,
  renameBusiness,
  setSourceRule,
  setTransactionChoice,
  setTransactionChoices,
} from "./sorting";

// Synthetic owners and values only; they exist in this file and nowhere else.
const A = "owner-sort-a";
const B = "owner-sort-b";
let ctx: Ctx;
let accountA: string;
let seq = 0;

async function deposit(owner: string, account: string, name: string, merchant: string | null = null) {
  seq += 1;
  const r = await ctx.run(owner, (tx) =>
    tx.query<{ id: string; source_key: string }>(
      `INSERT INTO transactions (owner_id, account_id, plaid_transaction_id, amount_cents, date, name, merchant, category)
       VALUES ($1, $2, $3, 1000, '2026-06-01', $4, $5, 'TRANSFER_IN') RETURNING id, source_key`,
      [owner, account, `tx-sort-${seq}`, name, merchant],
    ),
  );
  return r.rows[0];
}

const rows = (owner: string, sql: string, params: unknown[] = []) =>
  ctx.run(owner, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);

beforeAll(async () => {
  ctx = await setupDb();
  accountA = await addAccount(ctx, A, "item-sort-a", "acct-sort-a");
});

describe("source key", () => {
  it("groups descriptions that differ only in ids and dates", async () => {
    const one = await deposit(A, accountA, "APP TRANSFER FROM CLIENT ONE 10/03 #4821");
    const two = await deposit(A, accountA, "App Transfer from Client One 11/07 #9930");
    expect(one.source_key).toBe("app transfer from client one");
    expect(two.source_key).toBe(one.source_key);
  });

  it("prefers the merchant Plaid named, and never comes out empty", async () => {
    expect((await deposit(A, accountA, "REF 123", "Shop.Example")).source_key).toBe("shop example");
    expect((await deposit(A, accountA, "123456")).source_key).toBe("123456");
  });
});

describe("source rules", () => {
  it("marks a source and changes it in place", async () => {
    const { source_key } = await deposit(A, accountA, "CLIENT TWO PAYMENT");
    expect(await setSourceRule(ctx.run, A, { sourceKey: source_key, kind: "income", businessId: "" })).toEqual({ ok: true });
    expect(await setSourceRule(ctx.run, A, { sourceKey: source_key, kind: "not_income", businessId: null })).toEqual({ ok: true });
    const saved = await rows(A, "SELECT kind, business_id FROM transaction_rules WHERE source_key = $1", [source_key]);
    expect(saved).toEqual([{ kind: "not_income", business_id: null }]);
  });

  it("refuses a kind it does not know, or a source with no transactions", async () => {
    const { source_key } = await deposit(A, accountA, "CLIENT THREE");
    expect((await setSourceRule(ctx.run, A, { sourceKey: source_key, kind: "salary", businessId: null })).ok).toBe(false);
    expect((await setSourceRule(ctx.run, A, { sourceKey: "never seen", kind: "income", businessId: null })).ok).toBe(false);
  });

  it("removes a rule", async () => {
    const { source_key } = await deposit(A, accountA, "CLIENT FOUR");
    await setSourceRule(ctx.run, A, { sourceKey: source_key, kind: "income", businessId: null });
    const [rule] = await rows(A, "SELECT id FROM transaction_rules WHERE source_key = $1", [source_key]);
    expect(await removeSourceRule(ctx.run, A, rule.id)).toEqual({ ok: true });
    expect(await rows(A, "SELECT 1 FROM transaction_rules WHERE source_key = $1", [source_key])).toEqual([]);
  });
});

describe("transaction choices", () => {
  it("records a choice for one deposit, then removes it", async () => {
    const { id } = await deposit(A, accountA, "MOBILE DEPOSIT 0001");
    expect(await setTransactionChoice(ctx.run, A, { transactionId: id, kind: "income", businessId: null })).toEqual({ ok: true });
    expect(await rows(A, "SELECT kind FROM transaction_choices WHERE transaction_id = $1", [id])).toEqual([{ kind: "income" }]);
    expect(await removeTransactionChoice(ctx.run, A, id)).toEqual({ ok: true });
    expect(await rows(A, "SELECT 1 FROM transaction_choices WHERE transaction_id = $1", [id])).toEqual([]);
  });

  it("decides several deposits at once and leaves the rest alone", async () => {
    const one = await deposit(A, accountA, "MOBILE DEPOSIT 0002");
    const two = await deposit(A, accountA, "MOBILE DEPOSIT 0003");
    const untouched = await deposit(A, accountA, "MOBILE DEPOSIT 0004");
    const result = await setTransactionChoices(ctx.run, A, {
      transactionIds: [one.id, two.id, one.id],
      kind: "not_income",
      businessId: "",
    });
    expect(result).toEqual({ ok: true });
    const saved = await rows(A, "SELECT transaction_id FROM transaction_choices WHERE kind = 'not_income'");
    expect(saved.map((r) => r.transaction_id).sort()).toEqual([one.id, two.id].sort());
    expect(await rows(A, "SELECT 1 FROM transaction_choices WHERE transaction_id = $1", [untouched.id])).toEqual([]);
  });

  it("refuses an empty pick, and refuses all of them if any one is not the owner's", async () => {
    const mine = await deposit(A, accountA, "CLIENT NINE");
    expect(await setTransactionChoices(ctx.run, A, { transactionIds: [], kind: "income", businessId: null })).toEqual({
      ok: false,
      message: "Tick at least one deposit.",
    });
    const strangers = await setTransactionChoices(ctx.run, B, { transactionIds: [mine.id], kind: "income", businessId: null });
    expect(strangers.ok).toBe(false);
    expect(await rows(A, "SELECT 1 FROM transaction_choices WHERE transaction_id = $1", [mine.id])).toEqual([]);
  });

  it("clears a budget choice's line item and tax category when the owner decides it is income", async () => {
    const { id } = await deposit(A, accountA, "CLIENT TEN");
    const [item] = await rows(A, "INSERT INTO planned_items (owner_id, name, amount_cents, frequency) VALUES ($1, 'Refunds', 100, 'monthly') RETURNING id", [A]);
    await rows(A, "INSERT INTO transaction_choices (owner_id, transaction_id, kind, planned_item_id) VALUES ($1, $2, 'planned_item', $3)", [A, id, item.id]);
    expect(await setTransactionChoice(ctx.run, A, { transactionId: id, kind: "income", businessId: null })).toEqual({ ok: true });
    expect(await rows(A, "SELECT kind, planned_item_id, tax_category_id FROM transaction_choices WHERE transaction_id = $1", [id])).toEqual([
      { kind: "income", planned_item_id: null, tax_category_id: null },
    ]);
  });

  it("refuses an id that is not a transaction of this owner", async () => {
    const { id } = await deposit(A, accountA, "CLIENT FIVE");
    expect((await setTransactionChoice(ctx.run, B, { transactionId: id, kind: "income", businessId: null })).ok).toBe(false);
    expect((await setTransactionChoice(ctx.run, A, { transactionId: "not-a-uuid", kind: "income", businessId: null })).ok).toBe(false);
  });
});

describe("businesses", () => {
  it("adds, renames and refuses a duplicate name", async () => {
    expect(await addBusiness(ctx.run, A, "  Studio  ")).toEqual({ ok: true });
    expect((await addBusiness(ctx.run, A, "Studio")).ok).toBe(false);
    expect((await addBusiness(ctx.run, A, "")).ok).toBe(false);
    const [studio] = await rows(A, "SELECT id, name FROM businesses WHERE name = 'Studio'");
    expect(await renameBusiness(ctx.run, A, studio.id, "Studio Co")).toEqual({ ok: true });
    expect(await rows(A, "SELECT name FROM businesses WHERE id = $1", [studio.id])).toEqual([{ name: "Studio Co" }]);
  });

  it("tags a rule with a business, and untags it when the business is removed", async () => {
    await addBusiness(ctx.run, A, "Shop");
    const [shop] = await rows(A, "SELECT id FROM businesses WHERE name = 'Shop'");
    const { source_key } = await deposit(A, accountA, "CLIENT SIX");
    expect(await setSourceRule(ctx.run, A, { sourceKey: source_key, kind: "income", businessId: shop.id })).toEqual({ ok: true });
    expect(await removeBusiness(ctx.run, A, shop.id)).toEqual({ ok: true });
    const [rule] = await rows(A, "SELECT kind, business_id FROM transaction_rules WHERE source_key = $1", [source_key]);
    expect(rule).toEqual({ kind: "income", business_id: null });
  });

  it("refuses another owner's business as a tag", async () => {
    await addBusiness(ctx.run, B, "Elsewhere");
    const [theirs] = await rows(B, "SELECT id FROM businesses");
    const { source_key } = await deposit(A, accountA, "CLIENT SEVEN");
    expect((await setSourceRule(ctx.run, A, { sourceKey: source_key, kind: "income", businessId: theirs.id })).ok).toBe(false);
  });

  it("shows a second owner none of the first owner's rules, choices or businesses", async () => {
    const { id } = await deposit(A, accountA, "CLIENT EIGHT");
    await setTransactionChoice(ctx.run, A, { transactionId: id, kind: "income", businessId: null });
    expect(await rows(A, "SELECT 1 FROM transaction_choices WHERE transaction_id = $1", [id])).toHaveLength(1);
    for (const table of ["transaction_rules", "transaction_choices"]) {
      expect(await rows(B, `SELECT 1 FROM ${table}`), table).toEqual([]);
    }
    expect(await rows(B, "SELECT name FROM businesses")).toEqual([{ name: "Elsewhere" }]);
  });
});
