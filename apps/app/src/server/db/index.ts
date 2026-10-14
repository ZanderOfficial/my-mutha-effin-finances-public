import { Pool } from "@neondatabase/serverless";
import { runWithOwner, type Queryable } from "./run-with-owner";

export type { Queryable } from "./run-with-owner";

/**
 * The only module that imports the database driver. Everything else reaches
 * Postgres through `withOwner`.
 *
 * DATABASE_URL must be the pooled connection string of the `mmff_app` role
 * (NOBYPASSRLS), never the project owner role: Neon's default roles bypass
 * row-level security. See setup/02-neon-database.md.
 */
export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Runs `fn` in a transaction scoped to `ownerId`. Fails closed: throws when
 * DATABASE_URL is missing. A Pool is created per call and ended afterwards,
 * which is the pattern Neon documents for serverless functions.
 */
export async function withOwner<T>(
  ownerId: string,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseNotConfiguredError();

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    return await runWithOwner(client as unknown as Queryable, ownerId, fn);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Runs one read-only query WITHOUT an owner scope. It exists only for the two
 * `private.*` SECURITY DEFINER lookups from migration 0004 (the owner id for a
 * Plaid item id, and the list of owner ids), which return nothing but owner
 * ids. Row-level security hides every table from an unscoped session, so this
 * cannot read data; do not add other callers. The statement must start with
 * SELECT and name a private.* function.
 */
export async function queryPrivateLookup<Row = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<Row[]> {
  if (!/^\s*SELECT\b/i.test(text) || !text.includes("private.") || text.includes(";")) {
    throw new Error("queryPrivateLookup only runs private.* lookups");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseNotConfiguredError();
  const pool = new Pool({ connectionString });
  try {
    const r = await pool.query(text, params);
    return r.rows as Row[];
  } finally {
    await pool.end();
  }
}
