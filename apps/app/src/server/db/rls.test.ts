import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithOwner, type Queryable } from "./run-with-owner";
import { migrationFiles, openTestDb } from "./test-db";

/**
 * Runs the real migration files on an in-process Postgres (no cloud) and
 * proves row-level security from the point of view of the non-bypass runtime
 * role. Owner ids and values below are synthetic and exist only in this file.
 */
let pg: PGlite;
const db = () => pg as unknown as Queryable;

// Synthetic owner ids; never real user ids.
const OWNER_A = "owner-a-test";
const OWNER_B = "owner-b-test";

const dummyToken = new Uint8Array(40);

async function insertItem(owner: string, plaidItemId: string) {
  const r = await runWithOwner(db(), owner, (tx) =>
    tx.query<{ id: string }>(
      `INSERT INTO items (owner_id, plaid_item_id, access_token_enc, key_version)
       VALUES ($1, $2, $3, 1) RETURNING id`,
      [owner, plaidItemId, dummyToken],
    ),
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  expect(migrationFiles().length).toBeGreaterThanOrEqual(3);
  // The migrated snapshot, as the runtime role the app uses. The test session
  // is a superuser, which bypasses RLS, so openTestDb runs SET ROLE first.
  pg = await openTestDb();

  const itemA = await insertItem(OWNER_A, "item-a");
  const acct = await runWithOwner(db(), OWNER_A, (tx) =>
    tx.query<{ id: string }>(
      `INSERT INTO accounts (owner_id, item_id, plaid_account_id, name, type, is_liability, balance_cents)
       VALUES ($1, $2, 'acct-a', 'Test account', 'depository', false, 12345) RETURNING id`,
      [OWNER_A, itemA],
    ),
  );
  await runWithOwner(db(), OWNER_A, async (tx) => {
    await tx.query(
      `INSERT INTO transactions (owner_id, account_id, plaid_transaction_id, amount_cents, date, name)
       VALUES ($1, $2, 'tx-a', -500, '2026-01-02', 'Test merchant')`,
      [OWNER_A, acct.rows[0].id],
    );
    await tx.query(
      `INSERT INTO budgets (owner_id, category, limit_cents) VALUES ($1, 'Food', 10000)`,
      [OWNER_A],
    );
    await tx.query(
      `INSERT INTO net_worth_daily (owner_id, date, assets_cents, liabilities_cents, net_worth_cents)
       VALUES ($1, '2026-01-02', 100, 40, 60)`,
      [OWNER_A],
    );
    await tx.query(
      `INSERT INTO provider_events (owner_id, event_type, dedup_key, payload)
       VALUES ($1, 'TRANSACTIONS', 'dedup-a', '{"webhook_code":"SYNC_UPDATES_AVAILABLE"}')`,
      [OWNER_A],
    );
    // The sorting tables (0006), so a second owner has something to fail to see.
    const business = await tx.query<{ id: string }>(
      `INSERT INTO businesses (owner_id, name) VALUES ($1, 'Test business') RETURNING id`,
      [OWNER_A],
    );
    await tx.query(
      `INSERT INTO transaction_rules (owner_id, source_key, kind, business_id)
       VALUES ($1, 'test merchant', 'income', $2)`,
      [OWNER_A, business.rows[0].id],
    );
    await tx.query(
      `INSERT INTO transaction_choices (owner_id, transaction_id, kind)
       SELECT $1, id, 'not_income' FROM transactions WHERE plaid_transaction_id = 'tx-a'`,
      [OWNER_A],
    );
    // The planned budget tables (0007).
    const category = await tx.query<{ id: string }>(
      `INSERT INTO tax_categories (owner_id, name) VALUES ($1, 'Test category') RETURNING id`,
      [OWNER_A],
    );
    const planned = await tx.query<{ id: string }>(
      `INSERT INTO planned_items (owner_id, name, amount_cents, frequency, tax_category_id)
       VALUES ($1, 'Test item', 1000, 'monthly', $2) RETURNING id`,
      [OWNER_A, category.rows[0].id],
    );
    await tx.query(
      `INSERT INTO planned_item_businesses (owner_id, item_id, business_id) VALUES ($1, $2, $3)`,
      [OWNER_A, planned.rows[0].id, business.rows[0].id],
    );
    // Budget vs. actual (0009): the start date, and a spending rule to a planned item.
    await tx.query(`INSERT INTO budget_settings (owner_id, start_date) VALUES ($1, '2026-10-01')`, [OWNER_A]);
    await tx.query(
      `INSERT INTO transaction_rules (owner_id, scope, source_key, kind, planned_item_id)
       VALUES ($1, 'spending', 'test merchant', 'planned_item', $2)`,
      [OWNER_A, planned.rows[0].id],
    );
    // One-time kinds (0012).
    await tx.query(`INSERT INTO one_time_kinds (owner_id, name) VALUES ($1, 'Test kind')`, [OWNER_A]);
  });
});

afterAll(async () => {
  await pg.close();
});

describe("row-level security", () => {
  it("lets owner A see only A's rows", async () => {
    const counts = await runWithOwner(db(), OWNER_A, async (tx) => {
      const out: Record<string, number> = {};
      for (const t of [
        "items",
        "accounts",
        "transactions",
        "budgets",
        "net_worth_daily",
        "provider_events",
        "businesses",
        "transaction_rules",
        "transaction_choices",
        "tax_categories",
        "planned_items",
        "planned_item_businesses",
        "budget_settings",
        "one_time_kinds",
      ]) {
        const r = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
        out[t] = r.rows[0].n;
      }
      return out;
    });
    expect(counts).toEqual({
      items: 1,
      accounts: 1,
      transactions: 1,
      budgets: 1,
      net_worth_daily: 1,
      provider_events: 1,
      businesses: 1,
      transaction_rules: 2,
      transaction_choices: 1,
      tax_categories: 1,
      planned_items: 1,
      planned_item_businesses: 1,
      budget_settings: 1,
      one_time_kinds: 1,
    });
  });

  it("shows owner B nothing, on every table", async () => {
    const tables = (
      await pg.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
      )
    ).rows.map((r) => r.tablename);
    expect(tables.length).toBe(18);
    await runWithOwner(db(), OWNER_B, async (tx) => {
      for (const t of tables) {
        const r = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
        expect(r.rows[0].n, t).toBe(0);
      }
    });
  });

  it("blocks B from updating or deleting A's rows", async () => {
    await runWithOwner(db(), OWNER_B, async (tx) => {
      await tx.query("UPDATE budgets SET limit_cents = 1");
      await tx.query("DELETE FROM budgets");
    });
    const r = await runWithOwner(db(), OWNER_A, (tx) =>
      tx.query<{ limit_cents: string }>("SELECT limit_cents FROM budgets"),
    );
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0].limit_cents)).toBe(10000);
  });

  it("rejects inserts with the wrong owner_id", async () => {
    await expect(
      runWithOwner(db(), OWNER_B, (tx) =>
        tx.query(`INSERT INTO budgets (owner_id, category, limit_cents) VALUES ($1, 'Rent', 1)`, [
          OWNER_A,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects reassigning a row to another owner", async () => {
    await expect(
      runWithOwner(db(), OWNER_A, (tx) =>
        tx.query(`UPDATE budgets SET owner_id = $1`, [OWNER_B]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses a child row that points at another owner's parent", async () => {
    const itemB = await insertItem(OWNER_B, "item-b");
    await expect(
      runWithOwner(db(), OWNER_A, (tx) =>
        tx.query(
          `INSERT INTO accounts (owner_id, item_id, plaid_account_id, name, type, is_liability)
           VALUES ($1, $2, 'acct-x', 'x', 'depository', false)`,
          [OWNER_A, itemB],
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses a choice or rule that points at another owner's transaction or business", async () => {
    const [txA, businessA] = await runWithOwner(db(), OWNER_A, async (tx) => [
      (await tx.query<{ id: string }>("SELECT id FROM transactions LIMIT 1")).rows[0].id,
      (await tx.query<{ id: string }>("SELECT id FROM businesses LIMIT 1")).rows[0].id,
    ]);
    await expect(
      runWithOwner(db(), OWNER_B, (tx) =>
        tx.query(`INSERT INTO transaction_choices (owner_id, transaction_id, kind) VALUES ($1, $2, 'income')`, [
          OWNER_B,
          txA,
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      runWithOwner(db(), OWNER_B, (tx) =>
        tx.query(
          `INSERT INTO transaction_rules (owner_id, source_key, kind, business_id) VALUES ($1, 'x', 'income', $2)`,
          [OWNER_B, businessA],
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses a choice that names another owner's one-time kind", async () => {
    const kindA = await runWithOwner(db(), OWNER_A, async (tx) => (await tx.query<{ id: string }>("SELECT id FROM one_time_kinds LIMIT 1")).rows[0].id);
    // One transaction, so the refused insert rolls B's rows back and B still owns nothing.
    await expect(
      runWithOwner(db(), OWNER_B, async (tx) => {
        const item = await tx.query<{ id: string }>(
          `INSERT INTO items (owner_id, plaid_item_id, access_token_enc, key_version) VALUES ($1, 'item-kind-b', $2, 1) RETURNING id`,
          [OWNER_B, dummyToken],
        );
        const account = await tx.query<{ id: string }>(
          `INSERT INTO accounts (owner_id, item_id, plaid_account_id, name, type, is_liability)
           VALUES ($1, $2, 'acct-kind-b', 'x', 'depository', false) RETURNING id`,
          [OWNER_B, item.rows[0].id],
        );
        const spend = await tx.query<{ id: string }>(
          `INSERT INTO transactions (owner_id, account_id, plaid_transaction_id, amount_cents, date, name)
           VALUES ($1, $2, 'tx-kind-b', -500, '2026-10-02', 'Test merchant') RETURNING id`,
          [OWNER_B, account.rows[0].id],
        );
        await tx.query(`INSERT INTO transaction_choices (owner_id, transaction_id, kind, one_time_kind_id) VALUES ($1, $2, 'one_time', $3)`, [
          OWNER_B,
          spend.rows[0].id,
          kindA,
        ]);
      }),
    ).rejects.toThrow(/one_time_kind_fkey/);
  });

  it("refuses a planned item or tag that points at another owner's item, category or business", async () => {
    const [itemA, categoryA, businessA] = await runWithOwner(db(), OWNER_A, async (tx) => [
      (await tx.query<{ id: string }>("SELECT id FROM planned_items LIMIT 1")).rows[0].id,
      (await tx.query<{ id: string }>("SELECT id FROM tax_categories LIMIT 1")).rows[0].id,
      (await tx.query<{ id: string }>("SELECT id FROM businesses LIMIT 1")).rows[0].id,
    ]);
    const asB = (sql: string, params: unknown[]) =>
      runWithOwner(db(), OWNER_B, (tx) => tx.query(sql, [OWNER_B, ...params]));
    await expect(
      asB(`INSERT INTO planned_items (owner_id, parent_id, name, amount_cents, frequency) VALUES ($1, $2, 'x', 1, 'monthly')`, [itemA]),
    ).rejects.toThrow();
    await expect(
      asB(`INSERT INTO planned_items (owner_id, name, amount_cents, frequency, tax_category_id) VALUES ($1, 'x', 1, 'monthly', $2)`, [categoryA]),
    ).rejects.toThrow();
    await expect(
      asB(`INSERT INTO planned_item_businesses (owner_id, item_id, business_id) VALUES ($1, $2, $3)`, [itemA, businessA]),
    ).rejects.toThrow();
  });

  it("fails closed with no app.owner_id set", async () => {
    const r = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM items");
    expect(r.rows[0].n).toBe(0);
    await expect(
      pg.query(
        `INSERT INTO budgets (owner_id, category, limit_cents) VALUES ('owner-a-test', 'Misc', 1)`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not leak app.owner_id after the transaction ends", async () => {
    await runWithOwner(db(), OWNER_A, async () => undefined);
    const r = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts");
    expect(r.rows[0].n).toBe(0);
  });

  it("rolls back and rethrows when the callback fails", async () => {
    await expect(
      runWithOwner(db(), OWNER_A, async (tx) => {
        await tx.query(`INSERT INTO budgets (owner_id, category, limit_cents) VALUES ($1, 'Temp', 1)`, [
          OWNER_A,
        ]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const r = await runWithOwner(db(), OWNER_A, (tx) =>
      tx.query("SELECT 1 FROM budgets WHERE category = 'Temp'"),
    );
    expect(r.rows).toHaveLength(0);
  });

  it("refuses an empty owner id", async () => {
    await expect(runWithOwner(db(), "  ", async () => 1)).rejects.toThrow();
  });
});

describe("schema guards", () => {
  it("runs every query as the runtime role, not the superuser that bypasses RLS", async () => {
    const r = await pg.query<{ current_user: string }>("SELECT current_user");
    expect(r.rows).toEqual([{ current_user: "mmff_app" }]);
  });

  it("has RLS enabled AND forced on every public table", async () => {
    const r = await pg.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    const offenders = r.rows.filter((x) => !x.relrowsecurity || !x.relforcerowsecurity);
    expect(offenders.map((o) => o.relname)).toEqual([]);
  });

  it("gives every public table an owner_id column and an owner policy", async () => {
    const noOwner = await pg.query<{ table_name: string }>(
      `SELECT t.table_name FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                           WHERE c.table_schema = 'public' AND c.table_name = t.table_name
                             AND c.column_name = 'owner_id' AND c.is_nullable = 'NO')`,
    );
    expect(noOwner.rows).toEqual([]);
    const noPolicy = await pg.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND NOT EXISTS (SELECT 1 FROM pg_policies p
                           WHERE p.schemaname = 'public' AND p.tablename = c.relname)`,
    );
    expect(noPolicy.rows).toEqual([]);
  });

  it("creates the runtime role without BYPASSRLS or superuser", async () => {
    const r = await pg.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'mmff_app'",
    );
    expect(r.rows).toEqual([{ rolbypassrls: false, rolsuper: false }]);
  });

  it("stores no money in float or numeric columns", async () => {
    const r = await pg.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (column_name LIKE '%\\_cents' ESCAPE '\\')
          AND data_type <> 'bigint'`,
    );
    expect(r.rows).toEqual([]);
    const floats = await pg.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type IN ('real', 'double precision', 'money')`,
    );
    expect(floats.rows).toEqual([]);
  });

  it("rejects free-form provider payloads", async () => {
    await expect(
      runWithOwner(db(), OWNER_A, (tx) =>
        tx.query(
          `INSERT INTO provider_events (owner_id, event_type, dedup_key, payload)
           VALUES ($1, 'X', 'dedup-bad', '{"message":"free text"}')`,
          [OWNER_A],
        ),
      ),
    ).rejects.toThrow();
  });
});
