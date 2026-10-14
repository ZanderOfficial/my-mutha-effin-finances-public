import { randomBytes } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runWithOwner, type Queryable } from "../db/run-with-owner";
import { openTestDb } from "../db/test-db";
import { ROTATE_CONFIRM_VALUE, parseRotateMode, rotateAll, rotateOwnerItems } from "./rotate-items";
import { decryptToken, encryptToken } from "./tokens";

/**
 * The per-item rotation against PGlite with the real migrations, run as the
 * non-bypass runtime role (mmff_app) so row-level security is in force.
 * Tokens and owners are synthetic strings that exist only in this file.
 */
let pg: PGlite;
const db = () => pg as unknown as Queryable;
const withOwner = <T>(owner: string, fn: (tx: Queryable) => Promise<T>) =>
  runWithOwner(db(), owner, fn);

const A = "owner-a-rotate-test";
const B = "owner-b-rotate-test";
const newKey = () => randomBytes(32).toString("base64");

const K1 = newKey();
const K2 = newKey();
const V1 = { TOKEN_ENC_KEY: K1 };
const ROTATED = { TOKEN_ENC_KEY: K1, TOKEN_ENC_KEY_V2: K2, TOKEN_ENC_KEY_CURRENT_VERSION: "2" };

const PLAIN = {
  a1: "synthetic-access-a1",
  a2: "synthetic-access-a2",
  b1: "synthetic-access-b1",
};

async function insertItem(owner: string, plaidItemId: string, plaintext: string, env = V1) {
  const t = encryptToken(plaintext, env);
  await withOwner(owner, (tx) =>
    tx.query(
      `INSERT INTO items (owner_id, plaid_item_id, access_token_enc, key_version)
       VALUES ($1, $2, $3, $4)`,
      [owner, plaidItemId, t.ciphertext, t.keyVersion],
    ),
  );
}

type Row = { plaid_item_id: string; access_token_enc: Uint8Array; key_version: number };
const rows = (owner: string) =>
  withOwner(owner, async (tx) => {
    const r = await tx.query<Row>(
      "SELECT plaid_item_id, access_token_enc, key_version FROM items ORDER BY plaid_item_id",
    );
    return r.rows;
  });

beforeAll(async () => {
  pg = await openTestDb();
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  for (const owner of [A, B]) {
    await withOwner(owner, (tx) => tx.query("DELETE FROM items"));
  }
  await insertItem(A, "pi-a1", PLAIN.a1);
  await insertItem(A, "pi-a2", PLAIN.a2);
  await insertItem(B, "pi-b1", PLAIN.b1);
});

describe("rotateOwnerItems", () => {
  it("re-encrypts under the new version and the old key is no longer needed", async () => {
    const counts = await rotateOwnerItems(withOwner, A, ROTATED, true);
    expect(counts).toEqual({ items: 2, current: 0, wouldRotate: 0, rotated: 2, failed: 0 });

    const after = await rotateOwnerItems(withOwner, A, ROTATED, true);
    expect(after).toMatchObject({ items: 2, current: 2, rotated: 0 });

    const stored = await rows(A);
    // Only the new key is configured: the tokens survived the rotation.
    const newOnly = { TOKEN_ENC_KEY_V2: K2 };
    expect(stored.map((r) => decryptToken(r.access_token_enc, newOnly))).toEqual([
      PLAIN.a1,
      PLAIN.a2,
    ]);
    for (const r of stored) {
      expect(r.key_version).toBe(2);
      expect(r.access_token_enc[0]).toBe(2);
    }
  });

  it("writes nothing in a dry run, but reports what it would do", async () => {
    const before = await rows(A);
    const counts = await rotateOwnerItems(withOwner, A, ROTATED, false);
    expect(counts).toEqual({ items: 2, current: 0, wouldRotate: 2, rotated: 0, failed: 0 });
    const after = await rows(A);
    expect(after.map((r) => Buffer.from(r.access_token_enc).toString("hex"))).toEqual(
      before.map((r) => Buffer.from(r.access_token_enc).toString("hex")),
    );
    expect(after.every((r) => r.key_version === 1)).toBe(true);
  });

  it("leaves another owner's Items alone", async () => {
    await rotateOwnerItems(withOwner, A, ROTATED, true);
    const b = await rows(B);
    expect(b.map((r) => r.key_version)).toEqual([1]);
    expect(decryptToken(b[0].access_token_enc, V1)).toBe(PLAIN.b1);
  });

  it("counts a tampered Item as failed, leaves it untouched and still rotates the rest", async () => {
    await withOwner(A, async (tx) => {
      const r = await tx.query<{ access_token_enc: Uint8Array }>(
        "SELECT access_token_enc FROM items WHERE plaid_item_id = 'pi-a1'",
      );
      const bad = Buffer.from(r.rows[0].access_token_enc);
      bad[bad.length - 1] ^= 0x01;
      await tx.query("UPDATE items SET access_token_enc = $1 WHERE plaid_item_id = 'pi-a1'", [bad]);
    });
    const tamperedBefore = Buffer.from((await rows(A))[0].access_token_enc).toString("hex");

    const counts = await rotateOwnerItems(withOwner, A, ROTATED, true);
    expect(counts).toMatchObject({ items: 2, rotated: 1, failed: 1 });

    const stored = await rows(A);
    expect(stored[0].key_version).toBe(1);
    expect(Buffer.from(stored[0].access_token_enc).toString("hex")).toBe(tamperedBefore);
    expect(stored[1].key_version).toBe(2);
  });

  it("fails every Item, changing none, when the old key is missing", async () => {
    const noOld = { TOKEN_ENC_KEY_V2: K2, TOKEN_ENC_KEY_CURRENT_VERSION: "2" };
    const counts = await rotateOwnerItems(withOwner, A, noOld, true);
    expect(counts).toMatchObject({ items: 2, rotated: 0, failed: 2 });
    expect((await rows(A)).every((r) => r.key_version === 1)).toBe(true);
  });

  it("writes the blob and the key_version column together, up to the highest version", async () => {
    const keys = { ...ROTATED, TOKEN_ENC_KEY_CURRENT_VERSION: "255", TOKEN_ENC_KEY_V255: newKey() };
    const ok = await rotateOwnerItems(withOwner, B, keys, true);
    expect(ok).toMatchObject({ rotated: 1 });
    const [row] = await rows(B);
    expect(row.key_version).toBe(255);
    expect(row.access_token_enc[0]).toBe(255);
    expect(decryptToken(row.access_token_enc, keys)).toBe(PLAIN.b1);
  });
});

describe("rotateAll", () => {
  it("covers every owner and sums the counts", async () => {
    const r = await rotateAll(withOwner, [A, B], ROTATED, true);
    expect(r).toEqual({ owners: 2, items: 3, current: 0, wouldRotate: 0, rotated: 3, failed: 0 });
    const left = await pg.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM items WHERE key_version <> 2",
    );
    // RLS shows nothing without an owner scope, so this also proves the
    // unscoped session cannot see Items; the per-owner reads above are the proof.
    expect(left.rows[0].n).toBe("0");
  });

  it("returns only counts, never ids or tokens", async () => {
    const r = await rotateAll(withOwner, [A, B], ROTATED, false);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/synthetic|owner-|pi-/);
    expect(Object.keys(r).sort()).toEqual([
      "current",
      "failed",
      "items",
      "owners",
      "rotated",
      "wouldRotate",
    ]);
  });
});

describe("parseRotateMode", () => {
  const confirmed = { MMFF_ROTATE_CONFIRM: ROTATE_CONFIRM_VALUE };

  it("refuses without the confirmation variable, with or without --apply", () => {
    expect(parseRotateMode([], {})).toMatchObject({ ok: false });
    expect(parseRotateMode(["--apply"], {})).toMatchObject({ ok: false });
    expect(parseRotateMode(["--apply"], { MMFF_ROTATE_CONFIRM: "yes" })).toMatchObject({
      ok: false,
    });
  });

  it("is a dry run unless --apply is passed", () => {
    expect(parseRotateMode([], confirmed)).toEqual({ ok: true, apply: false });
    expect(parseRotateMode(["--apply"], confirmed)).toEqual({ ok: true, apply: true });
  });

  it("refuses unknown arguments", () => {
    expect(parseRotateMode(["--force"], confirmed)).toMatchObject({ ok: false });
    expect(parseRotateMode(["--apply", "extra"], confirmed)).toMatchObject({ ok: false });
  });
});
