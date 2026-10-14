import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupDb, type Ctx } from "@/server/reports/test-helpers";

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

import { createItemAction, deleteItemAction } from "./planned-actions";

// Synthetic owner and values only.
const OWNER = "owner-plan-actions";
let ctx: Ctx;
const idle = { status: "idle", message: "" } as const;
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) f.set(key, value);
  return f;
};
const count = () =>
  ctx.run(OWNER, async (tx) =>
    Number((await tx.query<{ n: string }>("SELECT count(*) AS n FROM planned_items")).rows[0].n),
  );

beforeAll(async () => {
  ctx = await setupDb();
  state.run = ctx.run;
});
beforeEach(() => {
  state.owner = null;
});

describe("planned budget actions", () => {
  it("refuse a visitor who is not the owner and write nothing", async () => {
    await expect(createItemAction(idle, form({ name: "Rent", amount: "1500", frequency: "monthly" }))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(await count()).toBe(0);
  });

  it("add an item for the owner", async () => {
    state.owner = OWNER;
    const result = await createItemAction(idle, form({ name: "Rent", amount: "1500", frequency: "monthly" }));
    expect(result).toEqual({ status: "saved", message: "Added." });
    expect(await count()).toBe(1);
  });

  it("return the validation message instead of writing", async () => {
    state.owner = OWNER;
    const result = await createItemAction(idle, form({ name: "Rent", amount: "15.005", frequency: "monthly" }));
    expect(result).toEqual({ status: "error", message: "Enter dollars and cents, like 120 or 120.50." });
    expect(await deleteItemAction(idle, form({ itemId: "not-an-id" }))).toEqual({
      status: "error",
      message: "That item is not valid.",
    });
  });
});
