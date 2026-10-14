/**
 * Driver-agnostic core of the per-request owner scope. Kept free of any vendor
 * import so tests can drive it with an in-process Postgres.
 */
export type QueryResult<Row> = { rows: Row[] };

export type Queryable = {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<Row>>;
};

/**
 * Runs `fn` inside one transaction on `client` with `app.owner_id` set for that
 * transaction only (`set_config(..., true)`), so row-level security sees the
 * owner and the setting cannot leak to the next request on a pooled
 * connection. Rolls back on any error.
 */
export async function runWithOwner<T>(
  client: Queryable,
  ownerId: string,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  if (typeof ownerId !== "string" || ownerId.trim() === "") {
    throw new Error("withOwner requires a non-empty owner id");
  }
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.owner_id', $1, true)", [ownerId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original error is the one worth surfacing.
    }
    throw err;
  }
}
