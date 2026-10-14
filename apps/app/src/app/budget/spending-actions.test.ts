import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addAccount, setupDb, type Ctx } from "@/server/reports/test-helpers";

const state = vi.hoisted(() => ({ owner: null as string | null, run: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({
  requireOwner: async () => {
    if (!state.owner) throw new Error("NEXT_REDIRECT");
    return state.owner;
  },
}));
vi.mock("@/server/db", async () => {
  class DatabaseNotConfiguredError extends Error {}
  return {
    DatabaseNotConfiguredError,
    withOwner: (owner: string, fn: unknown) =>
      (state.run as (o: string, f: unknown) => Promise<unknown>)(owner, fn),
  };
});

import { addOneTimeKindAction, matchSpendingAction, removeOneTimeKindAction, renameOneTimeKindAction, sortMerchantAction } from "./spending-actions";

// Synthetic owner, merchants and amounts only.
const OWNER = "owner-spend-actions";
let ctx: Ctx;
let account: string;
let gym: string;
let studio: string;
let seq = 0;
const idle = { status: "idle", message: "" } as const;
const SORTED = { status: "saved", message: "Sorted. Its spending is matched below." };
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const one of [value].flat()) f.append(key, one);
  }
  return f;
};
const rows = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  ctx.run(OWNER, async (tx) => (await tx.query<T & Record<string, unknown>>(sql, params)).rows);

async function spend(merchant: string): Promise<string> {
  seq += 1;
  const [row] = await rows<{ id: string }>(
    `INSERT INTO transactions (owner_id, account_id, plaid_transaction_id, amount_cents, date, name, merchant)
     VALUES ($1, $2, $3, -2500, '2026-10-05', $4, $4) RETURNING id`,
    [OWNER, account, `tx-spend-actions-${seq}`, merchant],
  );
  return row.id;
}

const ruleFor = (sourceKey: string) =>
  rows("SELECT kind, planned_item_id, business_id, tax_category_id FROM transaction_rules WHERE scope = 'spending' AND source_key = $1", [sourceKey]);
const choiceFor = (transactionId: string) =>
  rows("SELECT kind, planned_item_id, business_id, tax_category_id FROM transaction_choices WHERE transaction_id = $1", [transactionId]);

beforeAll(async () => {
  ctx = await setupDb();
  state.run = ctx.run;
  account = await addAccount(ctx, OWNER, "item-spend-actions", "acct-spend-actions");
  [{ id: gym }] = await rows<{ id: string }>(
    "INSERT INTO planned_items (owner_id, name, amount_cents, frequency) VALUES ($1, 'Gym', 4000, 'monthly') RETURNING id",
    [OWNER],
  );
  [{ id: studio }] = await rows<{ id: string }>("INSERT INTO businesses (owner_id, name) VALUES ($1, 'Studio') RETURNING id", [OWNER]);
});

beforeEach(() => {
  state.owner = OWNER;
});

describe("sortMerchantAction", () => {
  it("refuses a visitor who is not the owner and writes nothing", async () => {
    state.owner = null;
    await spend("Lift Club");
    await expect(sortMerchantAction(idle, form({ do: "item", sourceKey: "lift club", always: "1", itemTarget: gym }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await ruleFor("lift club")).toEqual([]);
  });

  it("matches the merchant to a line item with a rule when Always is ticked", async () => {
    expect(await sortMerchantAction(idle, form({ do: "item", sourceKey: "lift club", always: "1", itemTarget: gym }))).toEqual(SORTED);
    expect(await ruleFor("lift club")).toEqual([{ kind: "planned_item", planned_item_id: gym, business_id: null, tax_category_id: null }]);
  });

  it("decides only the ticked charges when Always is unticked, and makes no rule", async () => {
    const ticked = await spend("Swim Hall");
    const other = await spend("Swim Hall");
    expect(await sortMerchantAction(idle, form({ do: "item", sourceKey: "swim hall", transactionId: ticked, itemTarget: gym }))).toEqual(SORTED);
    expect(await choiceFor(ticked)).toEqual([{ kind: "planned_item", planned_item_id: gym, business_id: null, tax_category_id: null }]);
    expect(await choiceFor(other)).toEqual([]);
    expect(await ruleFor("swim hall")).toEqual([]);
  });

  it("marks the merchant out of budget with its out-section For tag", async () => {
    await spend("Paper Co");
    const result = await sortMerchantAction(
      idle,
      form({ do: "out", sourceKey: "paper co", always: "1", outBusinessId: studio, outTaxCategoryId: "" }),
    );
    expect(result).toEqual(SORTED);
    expect(await ruleFor("paper co")).toEqual([{ kind: "out_of_budget", planned_item_id: null, business_id: studio, tax_category_id: null }]);
  });

  it("marks a merchant one-time with its For tag, and a single charge one-time keeping its tags", async () => {
    await spend("Art Fair");
    const result = await sortMerchantAction(
      idle,
      form({ do: "one", sourceKey: "art fair", always: "1", outBusinessId: studio, outTaxCategoryId: "" }),
    );
    expect(result).toEqual(SORTED);
    expect(await ruleFor("art fair")).toEqual([{ kind: "one_time", planned_item_id: null, business_id: studio, tax_category_id: null }]);
    const charge = await spend("Ladder Shop");
    await matchSpendingAction(idle, form({ transactionId: charge, target: "out", businessId: studio, taxCategoryId: "" }));
    await matchSpendingAction(idle, form({ transactionId: charge, target: "one" }));
    expect(await choiceFor(charge)).toEqual([{ kind: "one_time", planned_item_id: null, business_id: studio, tax_category_id: null }]);
  });

  it("names what a one-time purchase was, keeps it when moved, and forgets it when the kind is removed", async () => {
    const SAVED = { status: "saved", message: "Saved." };
    expect(await addOneTimeKindAction(idle, form({ name: "Eating out" }))).toMatchObject({ status: "saved" });
    expect(await addOneTimeKindAction(idle, form({ name: "Eating out" }))).toEqual({ status: "error", message: "You already have a one-time kind with that name." });
    const [{ id: meals }] = await rows<{ id: string }>("SELECT id FROM one_time_kinds WHERE name = 'Eating out'");
    expect(await renameOneTimeKindAction(idle, form({ kindId: meals, name: "Restaurants" }))).toMatchObject({ status: SAVED.status });

    await spend("Bistro Nine");
    await sortMerchantAction(idle, form({ do: "one", sourceKey: "bistro nine", always: "1", outBusinessId: "", outTaxCategoryId: "", outOneTimeKindId: meals }));
    expect(await rows("SELECT one_time_kind_id FROM transaction_rules WHERE source_key = 'bistro nine'")).toEqual([{ one_time_kind_id: meals }]);

    const charge = await spend("Noodle Bar");
    await matchSpendingAction(idle, form({ transactionId: charge, target: "one", businessId: "", taxCategoryId: "", oneTimeKindId: meals }));
    await matchSpendingAction(idle, form({ transactionId: charge, target: "one", businessId: studio }));
    expect(await rows("SELECT business_id, one_time_kind_id FROM transaction_choices WHERE transaction_id = $1", [charge])).toEqual([
      { business_id: studio, one_time_kind_id: meals },
    ]);

    await removeOneTimeKindAction(idle, form({ kindId: meals }));
    expect(await rows("SELECT kind, one_time_kind_id FROM transaction_choices WHERE transaction_id = $1", [charge])).toEqual([
      { kind: "one_time", one_time_kind_id: null },
    ]);
  });

  it("refuses a one-time kind that does not exist, and never names a kind for out of budget", async () => {
    const charge = await spend("Corner Kiosk");
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect(await matchSpendingAction(idle, form({ transactionId: charge, target: "one", oneTimeKindId: unknown }))).toEqual({
      status: "error",
      message: "That one-time kind does not exist.",
    });
    await matchSpendingAction(idle, form({ transactionId: charge, target: "out", oneTimeKindId: unknown }));
    expect(await rows("SELECT kind, one_time_kind_id FROM transaction_choices WHERE transaction_id = $1", [charge])).toEqual([
      { kind: "out_of_budget", one_time_kind_id: null },
    ]);
  });

  it("makes a new line item from the merchant with its new-section fields", async () => {
    await spend("Cloud Box");
    const result = await sortMerchantAction(
      idle,
      form({ do: "new", sourceKey: "cloud box", always: "1", newName: "Storage", newAmount: "25", newFrequency: "monthly", newTaxCategoryId: "", newBusinessId: studio }),
    );
    expect(result).toEqual(SORTED);
    const [item] = await rows<{ id: string; amount_cents: number }>("SELECT id, amount_cents FROM planned_items WHERE name = 'Storage'");
    expect(item.amount_cents).toBe(2500);
    expect(await ruleFor("cloud box")).toEqual([{ kind: "planned_item", planned_item_id: item.id, business_id: null, tax_category_id: null }]);
    expect(await rows("SELECT business_id FROM planned_item_businesses WHERE item_id = $1", [item.id])).toEqual([{ business_id: studio }]);
  });

  it("sends one merchant's charges to three different places in one save", async () => {
    const [{ id: food }] = await rows<{ id: string }>(
      "INSERT INTO planned_items (owner_id, name, amount_cents, frequency) VALUES ($1, 'Food', 40000, 'monthly') RETURNING id",
      [OWNER],
    );
    const [groceries, gear, gift, later] = [await spend("Big Mart"), await spend("Big Mart"), await spend("Big Mart"), await spend("Big Mart")];
    const result = await sortMerchantAction(
      idle,
      form({ do: "item", sourceKey: "big mart", itemTarget: food, [`each:${groceries}`]: "same", [`each:${gear}`]: gym, [`each:${gift}`]: "out", [`each:${later}`]: "skip" }),
    );
    expect(result).toEqual(SORTED);
    expect((await choiceFor(groceries))[0]).toMatchObject({ kind: "planned_item", planned_item_id: food });
    expect((await choiceFor(gear))[0]).toMatchObject({ kind: "planned_item", planned_item_id: gym });
    expect((await choiceFor(gift))[0]).toMatchObject({ kind: "out_of_budget" });
    expect(await choiceFor(later)).toEqual([]);
    expect(await ruleFor("big mart")).toEqual([]);
  });

  it("makes the rule with Always ticked, and the charges sent elsewhere become its exceptions", async () => {
    const [usual, odd] = [await spend("Fuel Stop"), await spend("Fuel Stop")];
    const result = await sortMerchantAction(idle, form({ do: "item", sourceKey: "fuel stop", always: "1", itemTarget: gym, [`each:${usual}`]: "same", [`each:${odd}`]: "out" }));
    expect(result).toEqual(SORTED);
    expect((await ruleFor("fuel stop"))[0]).toMatchObject({ kind: "planned_item", planned_item_id: gym });
    expect(await choiceFor(usual)).toEqual([]);
    expect((await choiceFor(odd))[0]).toMatchObject({ kind: "out_of_budget" });
  });

  it("sorts single charges with no choice for the merchant as a whole", async () => {
    const [one, two] = [await spend("Corner Shop"), await spend("Corner Shop")];
    expect(await sortMerchantAction(idle, form({ sourceKey: "corner shop", [`each:${one}`]: gym, [`each:${two}`]: "skip" }))).toEqual(SORTED);
    expect((await choiceFor(one))[0]).toMatchObject({ kind: "planned_item", planned_item_id: gym });
    expect(await choiceFor(two)).toEqual([]);
  });

  it("writes nothing when one charge's place is refused", async () => {
    const [kept, bad] = [await spend("Hard Ware"), await spend("Hard Ware")];
    const missing = "00000000-0000-4000-8000-00000000dead";
    const result = await sortMerchantAction(idle, form({ do: "item", sourceKey: "hard ware", always: "1", itemTarget: gym, [`each:${kept}`]: "same", [`each:${bad}`]: missing }));
    expect(result).toEqual({ status: "error", message: "That line item does not exist." });
    expect(await ruleFor("hard ware")).toEqual([]);
  });

  it("marks a single charge not spending, but never a whole merchant", async () => {
    const [deposit, other] = [await spend("Title Escrow"), await spend("Title Escrow")];
    expect(await sortMerchantAction(idle, form({ sourceKey: "title escrow", [`each:${deposit}`]: "not_spending", [`each:${other}`]: "skip" }))).toEqual(SORTED);
    expect(await choiceFor(deposit)).toEqual([{ kind: "not_spending", planned_item_id: null, business_id: null, tax_category_id: null }]);
    expect(await choiceFor(other)).toEqual([]);
    expect(await matchSpendingAction(idle, form({ sourceKey: "title escrow", always: "1", target: "not_spending" }))).toEqual({
      status: "error",
      message: "Not spending is for single charges, not a whole merchant.",
    });
    expect(await ruleFor("title escrow")).toEqual([]);
  });

  it("marks a merchant a transfer with Always, and a single charge without it", async () => {
    await spend("To Credit Union");
    expect(await sortMerchantAction(idle, form({ do: "transfer", sourceKey: "to credit union", always: "1" }))).toEqual(SORTED);
    expect(await ruleFor("to credit union")).toEqual([{ kind: "transfer", planned_item_id: null, business_id: null, tax_category_id: null }]);
    const once = await spend("Mixed Payee");
    expect(await sortMerchantAction(idle, form({ sourceKey: "mixed payee", [`each:${once}`]: "transfer" }))).toEqual(SORTED);
    expect((await choiceFor(once))[0]).toMatchObject({ kind: "transfer" });
  });

  it("asks what to do when no button was named", async () => {
    expect(await sortMerchantAction(idle, form({ sourceKey: "paper co", always: "1" }))).toEqual({
      status: "error",
      message: "Choose what to do with this merchant.",
    });
  });
});

describe("matchSpendingAction", () => {
  it("moves one charge to a line item from its target field", async () => {
    const charge = await spend("Juice Bar");
    expect(await matchSpendingAction(idle, form({ transactionId: charge, target: gym }))).toEqual({ status: "saved", message: "Sorted." });
    expect(await choiceFor(charge)).toEqual([{ kind: "planned_item", planned_item_id: gym, business_id: null, tax_category_id: null }]);
  });

  it("keeps a charge's tag when moved out of budget with no tag fields, and clears it for \"\"", async () => {
    const charge = await spend("Ink Shop");
    await matchSpendingAction(idle, form({ transactionId: charge, target: "out", businessId: studio, taxCategoryId: "" }));
    expect(await matchSpendingAction(idle, form({ transactionId: charge, target: "out" }))).toEqual({ status: "saved", message: "Sorted." });
    expect(await choiceFor(charge)).toEqual([{ kind: "out_of_budget", planned_item_id: null, business_id: studio, tax_category_id: null }]);
    await matchSpendingAction(idle, form({ transactionId: charge, target: "out", businessId: "", taxCategoryId: "" }));
    expect(await choiceFor(charge)).toEqual([{ kind: "out_of_budget", planned_item_id: null, business_id: null, tax_category_id: null }]);
  });

  it("refuses a target that is neither a line item nor out of budget", async () => {
    const charge = await spend("Juice Bar");
    expect(await matchSpendingAction(idle, form({ transactionId: charge, target: "" }))).toEqual({
      status: "error",
      message: "Choose a line item, out of budget or one-time.",
    });
  });
});
