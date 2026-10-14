import { account, seedItem, setupDb } from "@/server/sync/test-helpers";
import type { AccountRow } from "@/server/institutions/repository";
import type { ReportDeps } from "./loaders";

/**
 * Test-only. Every value inserted here is synthetic and lives in test files;
 * nothing in the app can reach it. The database is the real migrations on
 * PGlite, queried as the runtime role mmff_app so row-level security applies.
 */
export type Ctx = Awaited<ReturnType<typeof setupDb>>;
export { setupDb, account };

export async function addAccount(
  ctx: Ctx,
  owner: string,
  itemKey: string,
  plaidAccountId: string,
  over: Partial<AccountRow> = {},
  status: "active" | "needs_reauth" | "revoked" = "active",
): Promise<string> {
  await seedItem(ctx, owner, itemKey, [account(plaidAccountId, over)], status);
  const r = await ctx.run(owner, (tx) =>
    tx.query<{ id: string }>(`SELECT id FROM accounts WHERE plaid_account_id = $1`, [
      plaidAccountId,
    ]),
  );
  return r.rows[0].id;
}

export type NewTx = {
  amount: number;
  date: string;
  pending?: boolean;
  category?: string | null;
  detail?: string | null;
  name?: string;
  merchant?: string | null;
  removed?: boolean;
};

let seq = 0;

export async function addTx(ctx: Ctx, owner: string, accountId: string, t: NewTx) {
  seq += 1;
  await ctx.run(owner, (tx) =>
    tx.query(
      `INSERT INTO transactions
         (owner_id, account_id, plaid_transaction_id, amount_cents, date, pending,
          name, merchant, category, category_detail, removed_at)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11)`,
      [
        owner,
        accountId,
        `tx-test-${seq}`,
        t.amount,
        t.date,
        t.pending ?? false,
        t.name ?? "Test merchant",
        t.merchant ?? null,
        t.category === undefined ? "FOOD_AND_DRINK" : t.category,
        t.detail ?? null,
        t.removed ? new Date("2026-01-01T00:00:00Z") : null,
      ],
    ),
  );
}

export async function addNetWorthDay(
  ctx: Ctx,
  owner: string,
  date: string,
  assets: number,
  liabilities: number,
  incomplete = false,
) {
  await ctx.run(owner, (tx) =>
    tx.query(
      `INSERT INTO net_worth_daily
         (owner_id, date, assets_cents, liabilities_cents, net_worth_cents, incomplete)
       VALUES ($1, $2::date, $3, $4, $5, $6)`,
      [owner, date, assets, liabilities, assets - liabilities, incomplete],
    ),
  );
}

export function depsFor(
  ctx: Ctx,
  owner: string | null,
  over: Partial<ReportDeps> = {},
): ReportDeps {
  return {
    getOwner: async () => owner,
    configured: () => true,
    run: ctx.run,
    now: () => new Date("2026-06-13T12:00:00Z"),
    timezone: () => "UTC",
    ...over,
  };
}
