import type { Queryable } from "../db/run-with-owner.ts";
import { reencryptToken } from "./rekey.ts";
import type { Env } from "./tokens.ts";

// `.ts` import specifiers are deliberate; see the note in rekey.ts.

/** Must be set, exactly, for the rotation script to run at all (dry run included). */
export const ROTATE_CONFIRM_VALUE = "dev-or-prod";

export type RotateMode = { ok: true; apply: boolean } | { ok: false; reason: string };

/**
 * Decides whether the rotation script may run and whether it may write. It
 * refuses without MMFF_ROTATE_CONFIRM=dev-or-prod, refuses any argument other
 * than `--apply`, and defaults to a dry run: only `--apply` writes.
 */
export function parseRotateMode(argv: readonly string[], env: Env): RotateMode {
  if (env.MMFF_ROTATE_CONFIRM !== ROTATE_CONFIRM_VALUE) {
    return {
      ok: false,
      reason: `Refusing to run: set MMFF_ROTATE_CONFIRM=${ROTATE_CONFIRM_VALUE} to confirm you meant to.`,
    };
  }
  const unknown = argv.filter((a) => a !== "--apply");
  if (unknown.length > 0) {
    return { ok: false, reason: "Refusing to run: the only accepted argument is --apply." };
  }
  return { ok: true, apply: argv.includes("--apply") };
}

/** Counts only. No ids, tokens, owner ids or error text ever go in here. */
export type RotateCounts = {
  items: number;
  /** Already on the newest version, left alone. */
  current: number;
  /** Dry run: would be re-encrypted. */
  wouldRotate: number;
  /** Apply: re-encrypted and written. */
  rotated: number;
  /** Could not be rotated (missing key, tampered, vanished). Left as they were. */
  failed: number;
};

export const emptyCounts = (): RotateCounts => ({
  items: 0,
  current: 0,
  wouldRotate: 0,
  rotated: 0,
  failed: 0,
});

export function addCounts(a: RotateCounts, b: RotateCounts): RotateCounts {
  return {
    items: a.items + b.items,
    current: a.current + b.current,
    wouldRotate: a.wouldRotate + b.wouldRotate,
    rotated: a.rotated + b.rotated,
    failed: a.failed + b.failed,
  };
}

export type WithOwner = <T>(ownerId: string, fn: (tx: Queryable) => Promise<T>) => Promise<T>;

type ItemOutcome = "current" | "wouldRotate" | "rotated";

/**
 * Re-encrypts one owner's Items, one Item per transaction. Each transaction
 * locks the row, derives the new blob with `reencryptToken` (which proves it
 * decrypts to the same plaintext before returning), and writes
 * `access_token_enc` and `key_version` together, so no Item is ever half
 * rotated. An Item that fails is counted and left exactly as it was; the loop
 * moves on. In a dry run nothing is written.
 */
export async function rotateOwnerItems(
  withOwner: WithOwner,
  ownerId: string,
  keys: Env,
  apply: boolean,
): Promise<RotateCounts> {
  const ids = await withOwner(ownerId, async (tx) => {
    const r = await tx.query<{ id: string }>(
      "SELECT id FROM items WHERE owner_id = $1 ORDER BY created_at, id",
      [ownerId],
    );
    return r.rows.map((row) => row.id);
  });

  const counts = emptyCounts();
  for (const id of ids) {
    counts.items += 1;
    try {
      const outcome = await withOwner(ownerId, async (tx): Promise<ItemOutcome> => {
        const r = await tx.query<{ access_token_enc: Uint8Array }>(
          "SELECT access_token_enc FROM items WHERE id = $1 AND owner_id = $2 FOR UPDATE",
          [id, ownerId],
        );
        const row = r.rows[0];
        if (!row) throw new Error("Item vanished");
        const next = reencryptToken(row.access_token_enc, keys);
        if (!next.changed) return "current";
        if (!apply) return "wouldRotate";
        const u = await tx.query(
          `UPDATE items SET access_token_enc = $3, key_version = $4, updated_at = now()
            WHERE id = $1 AND owner_id = $2 RETURNING id`,
          [id, ownerId, next.ciphertext, next.keyVersion],
        );
        if (u.rows.length !== 1) throw new Error("Item was not updated");
        return "rotated";
      });
      counts[outcome] += 1;
    } catch {
      counts.failed += 1;
    }
  }
  return counts;
}

/** Runs every owner in turn. Each owner is independent: one failure does not stop the next. */
export async function rotateAll(
  withOwner: WithOwner,
  ownerIds: readonly string[],
  keys: Env,
  apply: boolean,
): Promise<RotateCounts & { owners: number }> {
  let total = emptyCounts();
  for (const ownerId of ownerIds) {
    total = addCounts(total, await rotateOwnerItems(withOwner, ownerId, keys, apply));
  }
  return { ...total, owners: ownerIds.length };
}
