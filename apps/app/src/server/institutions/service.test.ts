import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "@/server/crypto/tokens";
import { PlaidApiError } from "@/server/plaid/errors";
import type { PlaidProvider } from "@/server/plaid/types";
import { ItemCapReachedError, MAX_LINKED_ITEMS, type InstitutionRepo, type NewItem } from "./repository";
import { createInstitutionService, InstitutionServiceError } from "./service";

// Per-run key and token: nothing here resembles a real credential.
const env = { TOKEN_ENC_KEY: randomBytes(32).toString("base64") };
const encrypt = (p: string) => encryptToken(p, env);
const decrypt = (c: Uint8Array) => decryptToken(c, env);

const PLAIN = `access-test-${randomBytes(8).toString("hex")}`;

function fakePlaid(over: Partial<PlaidProvider> = {}): PlaidProvider {
  return {
    createLinkToken: vi.fn(async () => ({ linkToken: "link-test", expiration: "x" })),
    createUpdateLinkToken: vi.fn(async () => ({ linkToken: "link-update-test", expiration: "x" })),
    exchangePublicToken: vi.fn(async () => ({ accessToken: PLAIN, itemId: "item-test-1" })),
    getItem: vi.fn(async () => ({
      itemId: "item-test-1",
      institutionId: "ins_test",
      institutionName: "Test Bank",
      errorCode: null,
    })),
    getAccounts: vi.fn(async () => [
      {
        accountId: "acct-1",
        name: "Checking",
        officialName: null,
        type: "depository",
        subtype: "checking",
        mask: "0001",
        currentDollars: 100.25,
        availableDollars: null,
        limitDollars: null,
        isoCurrencyCode: "USD",
      },
      {
        accountId: "acct-2",
        name: "Card",
        officialName: null,
        type: "credit",
        subtype: "credit card",
        mask: "9999",
        currentDollars: 40.1,
        availableDollars: 959.9,
        limitDollars: 1000,
        isoCurrencyCode: "USD",
      },
    ]),
    transactionsSync: vi.fn(async () => {
      throw new Error("not used here");
    }),
    transactionsRefresh: vi.fn(async () => undefined),
    getLiabilities: vi.fn(async () => []),
    getInvestmentsHoldings: vi.fn(async () => ({ accountIds: [], holdings: [], securities: [] })),
    getWebhookVerificationKey: vi.fn(async () => {
      throw new Error("not used here");
    }),
    removeItem: vi.fn(async () => undefined),
    ...over,
  };
}

function fakeRepo(over: Record<string, unknown> = {}) {
  const saved: NewItem[] = [];
  const repo = {
    countItems: vi.fn(async () => 0),
    saveItem: vi.fn(async (_o: string, item: NewItem) => {
      saved.push(item);
      return "00000000-0000-4000-8000-000000000001";
    }),
    getItemSecret: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      plaidItemId: "item-test-1",
      accessTokenEnc: encrypt(PLAIN).ciphertext,
      keyVersion: 1,
    })),
    deleteItem: vi.fn(async () => true),
    markNeedsReauth: vi.fn(async () => true),
    updateItemFromPlaid: vi.fn(async () => true),
    ...over,
  };
  return { repo: repo as unknown as InstitutionRepo, saved, fns: repo };
}

describe("completeLink", () => {
  it("encrypts the token before it reaches the repository and never returns it", async () => {
    const plaid = fakePlaid();
    const { repo, saved } = fakeRepo();
    const svc = createInstitutionService({ plaid, repo, encrypt, decrypt });

    const summary = await svc.completeLink("owner-1", { publicToken: "public-test-token" });

    expect(saved).toHaveLength(1);
    const stored = saved[0];
    expect(Buffer.isBuffer(stored.token.ciphertext)).toBe(true);
    expect(stored.token.ciphertext.includes(Buffer.from(PLAIN))).toBe(false);
    expect(decryptToken(stored.token.ciphertext, env)).toBe(PLAIN);
    expect(JSON.stringify(stored)).not.toContain(PLAIN);
    expect(JSON.stringify(summary)).not.toContain(PLAIN);
    expect(summary).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      institutionName: "Test Bank",
      status: "active",
      accountCount: 2,
    });
  });

  it("converts dollars to cents and flags liabilities", async () => {
    const { repo, saved } = fakeRepo();
    await createInstitutionService({ plaid: fakePlaid(), repo, encrypt, decrypt }).completeLink(
      "owner-1",
      { publicToken: "public-test-token" },
    );
    const [chk, card] = saved[0].accounts;
    expect(chk).toMatchObject({ balanceCents: 10025, availableCents: null, isLiability: false });
    expect(card).toMatchObject({ balanceCents: 4010, limitCents: 100000, isLiability: true, mask: "9999" });
  });

  it("enforces the cap before exchanging anything", async () => {
    const plaid = fakePlaid();
    const { repo } = fakeRepo({ countItems: vi.fn(async () => MAX_LINKED_ITEMS) });
    const svc = createInstitutionService({ plaid, repo, encrypt, decrypt });
    await expect(svc.completeLink("owner-1", { publicToken: "public-test-token" })).rejects.toMatchObject({
      kind: "cap_reached",
    });
    expect(plaid.exchangePublicToken).not.toHaveBeenCalled();
  });

  it("removes the Plaid Item when the cap is hit during the save (race)", async () => {
    const plaid = fakePlaid();
    const { repo } = fakeRepo({
      saveItem: vi.fn(async () => {
        throw new ItemCapReachedError();
      }),
    });
    const svc = createInstitutionService({ plaid, repo, encrypt, decrypt });
    await expect(svc.completeLink("owner-1", { publicToken: "public-test-token" })).rejects.toMatchObject({
      kind: "cap_reached",
    });
    expect(plaid.removeItem).toHaveBeenCalledWith(PLAIN);
  });

  it("marks an Item that arrives in login-required state as needs_reauth", async () => {
    const plaid = fakePlaid({
      getItem: vi.fn(async () => ({
        itemId: "item-test-1",
        institutionId: null,
        institutionName: null,
        errorCode: "ITEM_LOGIN_REQUIRED",
      })),
    });
    const { repo, saved } = fakeRepo();
    const s = await createInstitutionService({ plaid, repo, encrypt, decrypt }).completeLink("o", {
      publicToken: "public-test-token",
      institutionName: "  Client Name  ",
    });
    expect(s.status).toBe("needs_reauth");
    expect(s.institutionName).toBe("Client Name");
    expect(saved[0].lastErrorCode).toBe("ITEM_LOGIN_REQUIRED");
  });

  it("surfaces a safe Plaid error", async () => {
    const plaid = fakePlaid({
      exchangePublicToken: vi.fn(async () => {
        throw new PlaidApiError("INVALID_PUBLIC_TOKEN", 400);
      }),
    });
    const svc = createInstitutionService({ plaid, repo: fakeRepo().repo, encrypt, decrypt });
    await expect(svc.completeLink("o", { publicToken: "public-test-token" })).rejects.toBeInstanceOf(
      InstitutionServiceError,
    );
  });
});

describe("reconnect, refresh and unlink", () => {
  it("decrypts the stored token only to create the update-mode link token", async () => {
    const plaid = fakePlaid();
    const svc = createInstitutionService({ plaid, repo: fakeRepo().repo, encrypt, decrypt });
    const r = await svc.startReconnect("owner-1", "00000000-0000-4000-8000-000000000001");
    expect(r).toEqual({ linkToken: "link-update-test" });
    expect(plaid.createUpdateLinkToken).toHaveBeenCalledWith({ ownerId: "owner-1", accessToken: PLAIN });
  });

  it("reports not_found for an Item the owner does not have", async () => {
    const { repo } = fakeRepo({ getItemSecret: vi.fn(async () => null) });
    const plaid = fakePlaid();
    const svc = createInstitutionService({ plaid, repo, encrypt, decrypt });
    await expect(svc.startReconnect("o", "00000000-0000-4000-8000-000000000009")).rejects.toMatchObject({
      kind: "not_found",
    });
    expect(plaid.createUpdateLinkToken).not.toHaveBeenCalled();
  });

  it("refresh clears needs_reauth when Plaid reports no error", async () => {
    const { repo, fns } = fakeRepo();
    const svc = createInstitutionService({ plaid: fakePlaid(), repo, encrypt, decrypt });
    expect(await svc.refreshItem("o", "00000000-0000-4000-8000-000000000001")).toEqual({ status: "active" });
    expect(fns.updateItemFromPlaid).toHaveBeenCalledWith(
      "o",
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({ status: "active", lastErrorCode: null }),
    );
  });

  it("refresh marks needs_reauth when a call fails with ITEM_LOGIN_REQUIRED", async () => {
    const plaid = fakePlaid({
      getItem: vi.fn(async () => {
        throw new PlaidApiError("ITEM_LOGIN_REQUIRED", 400);
      }),
    });
    const { repo, fns } = fakeRepo();
    const svc = createInstitutionService({ plaid, repo, encrypt, decrypt });
    expect(await svc.refreshItem("o", "00000000-0000-4000-8000-000000000001")).toEqual({
      status: "needs_reauth",
    });
    expect(fns.markNeedsReauth).toHaveBeenCalled();
  });

  it("unlink removes at Plaid before deleting rows", async () => {
    const order: string[] = [];
    const plaid = fakePlaid({
      removeItem: vi.fn(async () => {
        order.push("plaid");
      }),
    });
    const { repo } = fakeRepo({
      deleteItem: vi.fn(async () => {
        order.push("db");
        return true;
      }),
    });
    await createInstitutionService({ plaid, repo, encrypt, decrypt }).unlink(
      "o",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(order).toEqual(["plaid", "db"]);
  });

  it("unlink keeps the rows when Plaid fails, but proceeds when Plaid already forgot the Item", async () => {
    const failing = fakePlaid({
      removeItem: vi.fn(async () => {
        throw new PlaidApiError("RATE_LIMIT", 429);
      }),
    });
    const a = fakeRepo();
    await expect(
      createInstitutionService({ plaid: failing, repo: a.repo, encrypt, decrypt }).unlink(
        "o",
        "00000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toMatchObject({ kind: "plaid" });
    expect(a.fns.deleteItem).not.toHaveBeenCalled();

    const gone = fakePlaid({
      removeItem: vi.fn(async () => {
        throw new PlaidApiError("ITEM_NOT_FOUND", 400);
      }),
    });
    const b = fakeRepo();
    await createInstitutionService({ plaid: gone, repo: b.repo, encrypt, decrypt }).unlink(
      "o",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(b.fns.deleteItem).toHaveBeenCalled();
  });
});
