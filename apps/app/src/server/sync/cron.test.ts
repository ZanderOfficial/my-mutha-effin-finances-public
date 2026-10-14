import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleSnapshotCron, isAuthorisedCron } from "./cron";
import { createSyncService } from "./service";
import { createSnapshotService } from "./snapshot";
import { PlaidApiError } from "@/server/plaid/errors";
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
beforeAll(async () => {
  ctx = await setupDb();
});
afterAll(async () => {
  await ctx.pg.close();
});

const SECRET = "cron-secret-for-tests-only";
const req = (auth?: string) =>
  new Request("http://localhost/api/cron/snapshot", {
    headers: auth === undefined ? {} : { authorization: auth },
  });

describe("cron authorisation", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorisedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorisedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorisedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorisedCron(null, SECRET)).toBe(false);
  });
  it("fails closed when CRON_SECRET is unset or blank", () => {
    expect(isAuthorisedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorisedCron("Bearer ", "")).toBe(false);
    expect(isAuthorisedCron("Bearer  ", "  ")).toBe(false);
  });

  it.each([
    ["missing header", undefined, SECRET],
    ["wrong secret", "Bearer nope", SECRET],
    ["unset CRON_SECRET", `Bearer ${SECRET}`, undefined],
  ])("answers 401 and runs nothing on %s", async (_n, auth, secret) => {
    const ownerIds = vi.fn(async () => ["o"]);
    const runSnapshot = vi.fn();
    const res = await handleSnapshotCron(req(auth), { secret, ownerIds, runSnapshot });
    expect(res.status).toBe(401);
    expect(ownerIds).not.toHaveBeenCalled();
    expect(runSnapshot).not.toHaveBeenCalled();
  });

  it("runs every owner, counting failures without stopping", async () => {
    const runSnapshot = vi.fn(async (o: string) => {
      if (o === "bad") throw new Error("x");
      return {
        date: "d",
        refreshed: 0,
        refreshFailed: 0,
        snapshots: 1,
        netWorthWritten: true,
        incomplete: false,
        transactionsSynced: 0,
        transactionsFailed: 0,
      };
    });
    const res = await handleSnapshotCron(req(`Bearer ${SECRET}`), {
      secret: SECRET,
      ownerIds: async () => ["good", "bad", "good2"],
      runSnapshot,
    });
    expect(runSnapshot).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ owners: 3, succeeded: 2, failed: 1, netWorthRows: 2 });
  });
});

describe("snapshot service", () => {
  const NOW = new Date("2026-03-10T03:30:00Z");

  function runner(plaid = fakePlaid(), now = NOW, timeZone = "America/Los_Angeles") {
    const sync = createSyncService({ plaid, repo: ctx.syncRepo, decrypt: fakeDecrypt });
    return createSnapshotService({ repo: ctx.syncRepo, sync, timeZone, now: () => now });
  }
  const q = (owner: string, sql: string) =>
    ctx.run(owner, async (tx) => (await tx.query<Record<string, unknown>>(sql)).rows);

  it("writes per-account snapshots and one net-worth row dated in the owner's zone, and reruns are idempotent", async () => {
    const owner = "owner-cron-1";
    await seedItem(ctx, owner, "pi-c1", [
      account("pa-c1-chk", { balanceCents: 100000 }),
      account("pa-c1-card", { type: "credit", isLiability: true, balanceCents: 30000 }),
      account("pa-c1-inv", { type: "investment", balanceCents: 50000 }),
    ]);
    const getAccounts = vi.fn(async () => [
      accountInfo("pa-c1-chk", { currentDollars: 1000 }),
      accountInfo("pa-c1-card", { type: "credit", currentDollars: 300 }),
      accountInfo("pa-c1-inv", { type: "investment", currentDollars: 500 }),
    ]);
    const s = runner(fakePlaid({ getAccounts }));

    const r1 = await s.run(owner);
    const r2 = await s.run(owner);
    expect(r1).toMatchObject({ date: "2026-03-09", snapshots: 3, netWorthWritten: true, incomplete: false });
    expect(r2.date).toBe("2026-03-09");

    expect(await q(owner, "SELECT 1 FROM balance_snapshots")).toHaveLength(3);
    const nw = await q(owner, "SELECT * FROM net_worth_daily");
    expect(nw).toHaveLength(1);
    expect(nw[0]).toMatchObject({ incomplete: false });
    expect(Number(nw[0].assets_cents)).toBe(150000);
    expect(Number(nw[0].liabilities_cents)).toBe(30000);
    expect(Number(nw[0].net_worth_cents)).toBe(120000);

    // A later run the same day with a changed balance overwrites, not duplicates.
    getAccounts.mockImplementation(async () => [
      accountInfo("pa-c1-chk", { currentDollars: 1100 }),
      accountInfo("pa-c1-card", { type: "credit", currentDollars: 300 }),
      accountInfo("pa-c1-inv", { type: "investment", currentDollars: 500 }),
    ]);
    await s.run(owner);
    const after = await q(owner, "SELECT net_worth_cents FROM net_worth_daily");
    expect(after).toHaveLength(1);
    expect(Number(after[0].net_worth_cents)).toBe(130000);
    expect(await q(owner, "SELECT 1 FROM balance_snapshots")).toHaveLength(3);
  });

  it("flags an unknown balance as incomplete instead of counting it as zero", async () => {
    const owner = "owner-cron-2";
    await seedItem(ctx, owner, "pi-c2", [
      account("pa-c2-a", { balanceCents: 2000 }),
      account("pa-c2-b", { balanceCents: null }),
    ]);
    const s = runner(
      fakePlaid({
        getAccounts: vi.fn(async () => [
          accountInfo("pa-c2-a", { currentDollars: 20 }),
          accountInfo("pa-c2-b", { currentDollars: null }),
        ]),
      }),
    );
    const r = await s.run(owner);
    expect(r).toMatchObject({ snapshots: 1, incomplete: true, netWorthWritten: true });
    const nw = await q(owner, "SELECT net_worth_cents, incomplete FROM net_worth_daily");
    expect(Number(nw[0].net_worth_cents)).toBe(2000);
    expect(nw[0].incomplete).toBe(true);
    expect(await q(owner, "SELECT 1 FROM balance_snapshots")).toHaveLength(1);
  });

  it("writes no net-worth row when no balance is known", async () => {
    const owner = "owner-cron-3";
    await seedItem(ctx, owner, "pi-c3", [account("pa-c3", { balanceCents: null })]);
    const s = runner(
      fakePlaid({ getAccounts: vi.fn(async () => [accountInfo("pa-c3", { currentDollars: null })]) }),
    );
    const r = await s.run(owner);
    expect(r.netWorthWritten).toBe(false);
    expect(await q(owner, "SELECT 1 FROM net_worth_daily")).toHaveLength(0);
    // And an owner with nothing linked at all.
    expect((await runner().run("owner-cron-empty")).netWorthWritten).toBe(false);
  });

  it("keeps going when an Item fails to refresh, using its last stored balance", async () => {
    const owner = "owner-cron-4";
    await seedItem(ctx, owner, "pi-c4", [account("pa-c4", { balanceCents: 4200 })]);
    const s = runner(
      fakePlaid({
        getAccounts: vi.fn(async () => {
          throw new Error("provider down");
        }),
      }),
    );
    const r = await s.run(owner);
    expect(r).toMatchObject({ refreshFailed: 1, refreshed: 0, netWorthWritten: true });
    const nw = await q(owner, "SELECT net_worth_cents FROM net_worth_daily");
    expect(Number(nw[0].net_worth_cents)).toBe(4200);
  });

  it("syncs transactions for an Item that never synced, after the net-worth row is written", async () => {
    const owner = "owner-cron-5";
    await seedItem(ctx, owner, "pi-c5", [account("pa-c5", { balanceCents: 5000 })]);
    const transactionsSync = vi.fn(async () =>
      page({ added: [txn("tx-c5", "pa-c5", 12.5)], nextCursor: "cur-c5" }),
    );
    const s = runner(fakePlaid({ transactionsSync }));
    const r = await s.run(owner);
    expect(r).toMatchObject({ netWorthWritten: true, transactionsSynced: 1, transactionsFailed: 0 });
    // The first call is made without a cursor: that is the call Plaid needs
    // before it will send SYNC_UPDATES_AVAILABLE for the Item.
    expect(transactionsSync).toHaveBeenCalledWith("access-test-token", null);
    expect(await q(owner, "SELECT 1 FROM transactions")).toHaveLength(1);
    expect(await q(owner, "SELECT tx_cursor FROM items")).toEqual([{ tx_cursor: "cur-c5" }]);
  });

  it("still writes net worth when a transactions sync fails", async () => {
    const owner = "owner-cron-6";
    await seedItem(ctx, owner, "pi-c6", [account("pa-c6", { balanceCents: 600 })]);
    const s = runner(
      fakePlaid({
        transactionsSync: vi.fn(async () => {
          throw new PlaidApiError("RATE_LIMIT");
        }),
      }),
    );
    const r = await s.run(owner);
    expect(r).toMatchObject({ netWorthWritten: true, transactionsSynced: 0, transactionsFailed: 1 });
    expect(await q(owner, "SELECT 1 FROM net_worth_daily")).toHaveLength(1);
  });

  it("a second owner never sees the first owner's snapshots", async () => {
    expect(await q("owner-cron-1", "SELECT 1 FROM net_worth_daily")).toHaveLength(1);
    expect(await q("owner-cron-other", "SELECT 1 FROM net_worth_daily")).toHaveLength(0);
    expect(await q("owner-cron-other", "SELECT 1 FROM balance_snapshots")).toHaveLength(0);
  });
});
