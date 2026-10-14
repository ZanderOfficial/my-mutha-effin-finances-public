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

import { addBusinessAction, markSourceAction } from "./sorting-actions";

// Synthetic owner and values only.
const OWNER = "owner-sort-actions";
let ctx: Ctx;
const idle = { status: "idle", message: "" } as const;
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const one of [value].flat()) f.append(key, one);
  }
  return f;
};
const SORTED = { status: "saved", message: "Sorted. Its deposits are in the months below." };
const count = (table: string) =>
  ctx.run(OWNER, async (tx) =>
    Number((await tx.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),
  );

beforeAll(async () => {
  ctx = await setupDb();
  state.run = ctx.run;
  const account = await addAccount(ctx, OWNER, "item-actions", "acct-actions");
  await ctx.run(OWNER, (tx) =>
    tx.query(
      `INSERT INTO transactions (owner_id, account_id, plaid_transaction_id, amount_cents, date, name)
       VALUES ($1, $2, 'tx-actions', 1000, '2026-06-01', 'CLIENT PAYMENT'),
              ($1, $2, 'tx-actions-2', 2000, '2026-06-02', 'MOBILE DEPOSIT 1'),
              ($1, $2, 'tx-actions-3', 3000, '2026-06-03', 'MOBILE DEPOSIT 2')`,
      [OWNER, account],
    ),
  );
});
const mobileDepositIds = () =>
  ctx.run(OWNER, async (tx) =>
    (await tx.query<{ id: string }>(`SELECT id FROM transactions WHERE name LIKE 'MOBILE%' ORDER BY name`)).rows.map(
      (r) => r.id,
    ),
  );
beforeEach(() => {
  state.owner = null;
});

describe("sorting actions", () => {
  it("refuse a visitor who is not the owner and write nothing", async () => {
    await expect(addBusinessAction(idle, form({ name: "Studio" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await count("businesses")).toBe(0);
  });

  it("save a source rule for the owner when Always is ticked", async () => {
    state.owner = OWNER;
    const result = await markSourceAction(
      idle,
      form({ sourceKey: "client payment", kind: "income", businessId: "", always: "1" }),
    );
    expect(result).toEqual(SORTED);
    expect(await count("transaction_rules")).toBe(1);
  });

  it("decide only the ticked deposits, with no rule, when Always is unticked", async () => {
    state.owner = OWNER;
    const [first] = await mobileDepositIds();
    const result = await markSourceAction(
      idle,
      form({ sourceKey: "mobile deposit", kind: "income", businessId: "", transactionId: [first] }),
    );
    expect(result).toEqual(SORTED);
    expect(await count("transaction_choices")).toBe(1);
    expect(await count("transaction_rules")).toBe(1);
  });

  it("ask for a deposit when Always is unticked and none is ticked", async () => {
    state.owner = OWNER;
    const result = await markSourceAction(idle, form({ sourceKey: "mobile deposit", kind: "income", businessId: "" }));
    expect(result).toEqual({ status: "error", message: "Tick at least one deposit." });
  });

  it("return the validation message instead of saving", async () => {
    state.owner = OWNER;
    const result = await markSourceAction(
      idle,
      form({ sourceKey: "client payment", kind: "salary", businessId: "", always: "1" }),
    );
    expect(result).toEqual({ status: "error", message: "Choose income or not income." });
  });
});
