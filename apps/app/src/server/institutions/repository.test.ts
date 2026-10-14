import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithOwner, type Queryable } from "@/server/db/run-with-owner";
import { openTestDb } from "@/server/db/test-db";
import {
  createInstitutionRepo,
  ItemCapReachedError,
  MAX_LINKED_ITEMS,
  type AccountRow,
  type NewItem,
} from "./repository";

/**
 * The real repository against PGlite with the real migrations, run as the
 * non-bypass runtime role. Owners and values are synthetic, test-file only.
 */
let pg: PGlite;
const db = () => pg as unknown as Queryable;
const repo = () =>
  createInstitutionRepo((owner, fn) => runWithOwner(db(), owner, fn));

const A = "owner-a-test";
const B = "owner-b-test";

function account(id: string, over: Partial<AccountRow> = {}): AccountRow {
  return {
    plaidAccountId: id,
    name: "Account",
    officialName: null,
    type: "depository",
    subtype: "checking",
    isLiability: false,
    balanceCents: 12345,
    availableCents: null,
    limitCents: null,
    isoCurrencyCode: "USD",
    mask: "0001",
    ...over,
  };
}

function item(plaidItemId: string, accounts: AccountRow[], over: Partial<NewItem> = {}): NewItem {
  return {
    plaidItemId,
    token: { ciphertext: Buffer.alloc(40, 7), keyVersion: 1 },
    institutionId: "ins_test",
    institutionName: "Test Bank",
    status: "active",
    lastErrorCode: null,
    accounts,
    ...over,
  };
}

beforeAll(async () => {
  pg = await openTestDb();
});

afterAll(async () => {
  await pg.close();
});

describe("institution repository", () => {
  it("saves an item with accounts and lists it without secrets", async () => {
    const r = repo();
    const id = await r.saveItem(
      A,
      item("pi-a1", [
        account("pa-1", { name: "A one", balanceCents: 5000 }),
        account("pa-2", { name: "B two", type: "credit", isLiability: true, balanceCents: 2500, availableCents: null }),
        account("pa-3", { name: "C three", balanceCents: null }),
      ]),
    );
    const list = await r.listInstitutions(A);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].institutionName).toBe("Test Bank");
    const [one, two, three] = list[0].accounts;
    expect(one.balanceCents).toBe(5000);
    expect(two).toMatchObject({ isLiability: true, balanceCents: 2500 });
    expect(three.balanceCents).toBeNull(); // unknown stays unknown, not zero
    const json = JSON.stringify(list);
    expect(json).not.toContain("access_token");
    expect(json).not.toContain("pi-a1");
  });

  it("stores the token as the encrypted bytes it was given", async () => {
    const r = await runWithOwner(db(), A, (tx) =>
      tx.query<{ access_token_enc: Uint8Array; key_version: number }>(
        "SELECT access_token_enc, key_version FROM items WHERE plaid_item_id = 'pi-a1'",
      ),
    );
    expect(Buffer.from(r.rows[0].access_token_enc).equals(Buffer.alloc(40, 7))).toBe(true);
    expect(r.rows[0].key_version).toBe(1);
  });

  it("upserts accounts when the same item is saved again", async () => {
    const r = repo();
    await r.saveItem(A, item("pi-a1", [account("pa-1", { name: "A one", balanceCents: 7777 })]));
    const [inst] = await r.listInstitutions(A);
        expect(inst.accounts.some((a) => a.balanceCents === 7777)).toBe(true);
    expect(await r.countItems(A)).toBe(1);
  });

  it("marks needs_reauth and counts it", async () => {
    const r = repo();
    const [inst] = await r.listInstitutions(A);
    expect(await r.countNeedsReauth(A)).toBe(0);
    expect(await r.markNeedsReauth(A, inst.id, "ITEM_LOGIN_REQUIRED")).toBe(true);
    expect(await r.countNeedsReauth(A)).toBe(1);
    expect((await r.listInstitutions(A))[0].status).toBe("needs_reauth");
    await r.updateItemFromPlaid(A, inst.id, { status: "active", lastErrorCode: null, accounts: null });
    expect(await r.countNeedsReauth(A)).toBe(0);
  });

  it("a second owner cannot see, read the token of, reauth-mark or delete the first owner's items", async () => {
    const r = repo();
    const [inst] = await r.listInstitutions(A);
    expect(await r.listInstitutions(B)).toEqual([]);
    expect(await r.countItems(B)).toBe(0);
    expect(await r.getItemSecret(B, inst.id)).toBeNull();
    expect(await r.markNeedsReauth(B, inst.id, "X")).toBe(false);
    expect(await r.deleteItem(B, inst.id)).toBe(false);
    expect(await r.listInstitutions(A)).toHaveLength(1);
  });

  it("owner B cannot overwrite owner A's item by saving the same Plaid item id", async () => {
    await expect(repo().saveItem(B, item("pi-a1", [account("pa-b")]))).rejects.toThrow();
    const [inst] = await repo().listInstitutions(A);
    expect(inst.institutionName).toBe("Test Bank");
  });

  it("rejects a non-uuid item id without querying", async () => {
    expect(await repo().getItemSecret(A, "not-a-uuid")).toBeNull();
    expect(await repo().deleteItem(A, "not-a-uuid")).toBe(false);
  });

  it("enforces the cap of 10 linked items per owner", async () => {
    const r = repo();
    const have = await r.countItems(B);
    for (let i = have; i < MAX_LINKED_ITEMS; i++) {
      await r.saveItem(B, item(`pi-b-${i}`, [account(`pa-b-${i}`)]));
    }
    expect(await r.countItems(B)).toBe(MAX_LINKED_ITEMS);
    await expect(r.saveItem(B, item("pi-b-extra", []))).rejects.toBeInstanceOf(ItemCapReachedError);
    // Owner A is unaffected by B's count.
    await r.saveItem(A, item("pi-a2", []));
    expect(await r.countItems(A)).toBe(2);
  });

  it("deletes the owner's item and cascades to its accounts", async () => {
    const r = repo();
    const list = await r.listInstitutions(A);
    const target = list[0];
    expect(await r.deleteItem(A, target.id)).toBe(true);
    expect((await r.listInstitutions(A)).some((i) => i.id === target.id)).toBe(false);
    const left = await runWithOwner(db(), A, (tx) =>
      tx.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM accounts WHERE item_id = $1",
        [target.id],
      ),
    );
    expect(left.rows[0].n).toBe("0");
  });
});
