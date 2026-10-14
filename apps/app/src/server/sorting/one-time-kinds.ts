// The owner's list for breaking down one-time spending (Eating out, Clothes, ...): read, add, rename and remove.
import type { Queryable } from "@/server/db";
import { isUuid, parseName } from "@/server/form-values";
import { OK, fail, type Run, type WriteResult } from "@/server/write-result";
import type { OneTimeKind } from "@/lib/sorting";

const MAX_KIND_NAME = 60;
const NAME_WORDS = `Enter a name of up to ${MAX_KIND_NAME} characters.`;
const TAKEN = "You already have a one-time kind with that name.";

export async function readOneTimeKinds(tx: Queryable, ownerId: string): Promise<OneTimeKind[]> {
  const r = await tx.query<OneTimeKind>(`SELECT id, name FROM one_time_kinds WHERE owner_id = $1 ORDER BY lower(name), id`, [ownerId]);
  return r.rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function addOneTimeKind(run: Run, ownerId: string, rawName: unknown): Promise<WriteResult> {
  const name = parseName(rawName, MAX_KIND_NAME);
  if (!name) return fail(NAME_WORDS);

  return run(ownerId, async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO one_time_kinds (owner_id, name) VALUES ($1, $2) ON CONFLICT (owner_id, name) DO NOTHING RETURNING id`,
      [ownerId, name],
    );
    return inserted.rows.length > 0 ? OK : fail(TAKEN);
  });
}

export async function renameOneTimeKind(run: Run, ownerId: string, kindId: unknown, rawName: unknown): Promise<WriteResult> {
  if (!isUuid(kindId)) return fail("That one-time kind is not valid.");
  const name = parseName(rawName, MAX_KIND_NAME);
  if (!name) return fail(NAME_WORDS);

  return run(ownerId, async (tx) => {
    const taken = await tx.query("SELECT 1 FROM one_time_kinds WHERE owner_id = $1 AND name = $2 AND id <> $3", [ownerId, name, kindId]);
    if (taken.rows.length > 0) return fail(TAKEN);
    await tx.query("UPDATE one_time_kinds SET name = $3 WHERE owner_id = $1 AND id = $2", [ownerId, kindId, name]);
    return OK;
  });
}

/** Removes a kind. Charges and rules that named it stay one-time, with no kind. */
export async function removeOneTimeKind(run: Run, ownerId: string, kindId: unknown): Promise<WriteResult> {
  if (!isUuid(kindId)) return fail("That one-time kind is not valid.");
  return run(ownerId, async (tx) => {
    await tx.query("DELETE FROM one_time_kinds WHERE owner_id = $1 AND id = $2", [ownerId, kindId]);
    return OK;
  });
}
