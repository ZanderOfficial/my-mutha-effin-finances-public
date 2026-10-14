import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlaidWebhookKey } from "@/server/plaid/types";
import { createSyncService } from "@/server/sync/service";
import {
  account,
  accountInfo,
  fakeDecrypt,
  fakePlaid,
  page,
  seedItem,
  setupDb,
  txn,
} from "@/server/sync/test-helpers";
import { createEventProcessor } from "./processor";
import { handlePlaidWebhook, type WebhookDeps } from "./plaid-webhook";
import { createEventsRepo } from "./repository";
import { createKeyCache, verifyPlaidWebhook } from "./verify";

let ctx: Awaited<ReturnType<typeof setupDb>>;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let publicKey: PlaidWebhookKey;
const KID = "kid-test-1";
const OWNER = "owner-webhook";
const PLAID_ITEM = "pi-webhook";


beforeAll(async () => {
  ctx = await setupDb();
  // Throwaway ES256 keypairs generated for this test run only.
  const pair = await generateKeyPair("ES256");
  const other = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  const jwk = (await exportJWK(pair.publicKey)) as JWK;
  publicKey = {
    alg: "ES256",
    crv: String(jwk.crv),
    kid: KID,
    kty: String(jwk.kty),
    use: "sig",
    x: String(jwk.x),
    y: String(jwk.y),
    expiredAt: null,
  };
  await seedItem(ctx, OWNER, PLAID_ITEM, [account("pa-wh")]);
});
afterAll(async () => {
  await ctx.pg.close();
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const nowSec = () => Math.floor(Date.now() / 1000);

async function sign(
  body: string,
  opts: { key?: CryptoKey; iat?: number; hash?: string; alg?: string; kid?: string } = {},
) {
  return new SignJWT({ request_body_sha256: opts.hash ?? sha(body) })
    .setProtectedHeader({ alg: (opts.alg ?? "ES256") as "ES256", kid: opts.kid ?? KID })
    .setIssuedAt(opts.iat ?? nowSec())
    .sign(opts.key ?? privateKey);
}

const syncBody = (extra: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: PLAID_ITEM,
      initial_update_complete: true,
      historical_update_complete: false,
      environment: "sandbox",
      ...extra,
    },
    null,
    2,
  );

const request = (body: string, token: string | null) =>
  new Request("http://localhost/api/webhooks/plaid", {
    method: "POST",
    body,
    headers: token ? { "Plaid-Verification": token } : {},
  });

function makeDeps(plaid = fakePlaid()) {
  const events = createEventsRepo(ctx.run);
  const sync = createSyncService({ plaid, repo: ctx.syncRepo, decrypt: fakeDecrypt });
  const processor = createEventProcessor({ events, repo: ctx.syncRepo, sync });
  const pending: Promise<void>[] = [];
  const processSpy = vi.fn((o: string, e: string) => processor.process(o, e));
  const getKey = createKeyCache(async () => publicKey);
  const deps: WebhookDeps = {
    verify: (rawBody, token) => verifyPlaidWebhook({ rawBody, token, getKey }),
    repo: ctx.syncRepo,
    events,
    process: processSpy,
    schedule: (work) => {
      pending.push(work());
    },
  };
  return { deps, processSpy, settle: () => Promise.all(pending), plaid };
}

const eventCount = async () =>
  Number(
    (await ctx.run(OWNER, async (tx) => (await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM provider_events")).rows))[0].n,
  );

describe("signature verification", () => {
  it.each([
    ["no Plaid-Verification header", async () => null as string | null, undefined],
    ["a signature from the wrong key", async (b: string) => sign(b, { key: otherPrivateKey }), undefined],
    ["an iat older than 5 minutes", async (b: string) => sign(b, { iat: nowSec() - 6 * 60 }), undefined],
    ["a body that does not match request_body_sha256", async (b: string) => sign(b, { hash: sha(b + " ") }), undefined],
    ["an unknown key id", async (b: string) => sign(b, { kid: "kid-unknown" }), "kid"],
  ])("rejects %s with 401 and writes nothing", async (_name, makeToken, mode) => {
    const before = await eventCount();
    const t = makeDeps();
    if (mode === "kid") {
      const cache = createKeyCache(async () => {
        throw new Error("no such key");
      });
      t.deps.verify = (rawBody, token) => verifyPlaidWebhook({ rawBody, token, getKey: cache });
    }
    const body = syncBody();
    const res = await handlePlaidWebhook(request(body, await makeToken(body)), t.deps);
    expect(res.status).toBe(401);
    await t.settle();
    expect(t.processSpy).not.toHaveBeenCalled();
    expect(await eventCount()).toBe(before);
  });

  it("rejects a token whose algorithm is not ES256", async () => {
    const body = syncBody();
    // HS256 token signed with an arbitrary symmetric secret.
    const hs = await new SignJWT({ request_body_sha256: sha(body) })
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .setIssuedAt()
      .sign(new TextEncoder().encode("0123456789abcdef0123456789abcdef"));
    const t = makeDeps();
    expect((await handlePlaidWebhook(request(body, hs), t.deps)).status).toBe(401);
    // And an unsigned (alg none) token.
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ request_body_sha256: sha(body), iat: nowSec() })).toString("base64url")}.`;
    expect((await handlePlaidWebhook(request(body, none), t.deps)).status).toBe(401);
    expect(await eventCount()).toBe(0);
  });

  it("rejects a body re-serialised after signing (hash covers the exact bytes)", async () => {
    const body = syncBody();
    const token = await sign(body);
    const reserialised = JSON.stringify(JSON.parse(body));
    const t = makeDeps();
    expect((await handlePlaidWebhook(request(reserialised, token), t.deps)).status).toBe(401);
  });

  it("refuses an expired key", async () => {
    const cache = createKeyCache(async () => ({ ...publicKey, expiredAt: nowSec() - 10 }));
    const body = syncBody();
    expect(await verifyPlaidWebhook({ rawBody: body, token: await sign(body), getKey: cache })).toBe(false);
  });

  it("accepts a valid signature", async () => {
    const body = syncBody();
    const ok = await verifyPlaidWebhook({
      rawBody: body,
      token: await sign(body),
      getKey: createKeyCache(async () => publicKey),
    });
    expect(ok).toBe(true);
  });
});

describe("webhook pipeline", () => {
  it("accepts a signed event, stores ids and codes only, and processes it once even if delivered twice", async () => {
    const transactionsSync = vi.fn(async () =>
      page({ added: [txn("tw1", "pa-wh", 5)], nextCursor: "w1" }),
    );
    const t = makeDeps(
      fakePlaid({ getAccounts: vi.fn(async () => [accountInfo("pa-wh")]), transactionsSync }),
    );
    // Extra free-form text that must NOT reach the database.
    const body = syncBody({ error: { error_code: "SOME_CODE", error_message: "free text with a bank name" }, institution_name: "Secret Bank", foo: "bar" });
    const token = await sign(body);

    const first = await handlePlaidWebhook(request(body, token), t.deps);
    expect(first.status).toBe(200);
    await t.settle();
    const second = await handlePlaidWebhook(request(body, token), t.deps);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    await t.settle();

    expect(transactionsSync).toHaveBeenCalledTimes(1);
    expect(t.processSpy).toHaveBeenCalledTimes(1);
    expect(await eventCount()).toBe(1);

    const ev = await ctx.run(OWNER, async (tx) => (await tx.query<{ payload: Record<string, unknown>; processed_at: Date | null; error: string | null }>("SELECT payload, processed_at, error FROM provider_events")).rows[0]);
    expect(ev.processed_at).not.toBeNull();
    expect(ev.error).toBeNull();
    expect(Object.keys(ev.payload).sort()).toEqual([
      "environment",
      "error_code",
      "historical_update_complete",
      "initial_update_complete",
      "item_id",
      "webhook_code",
      "webhook_type",
    ]);
    expect(JSON.stringify(ev.payload)).not.toContain("Secret Bank");

    const tx = await ctx.run(OWNER, async (q) => (await q.query("SELECT 1 FROM transactions WHERE plaid_transaction_id = 'tw1'")).rows);
    expect(tx).toHaveLength(1);
  });

  it("running the processor twice on one event changes nothing the second time", async () => {
    const transactionsSync = vi.fn(async () => page({ nextCursor: "w2" }));
    const t = makeDeps(fakePlaid({ getAccounts: vi.fn(async () => [accountInfo("pa-wh")]), transactionsSync }));
    const events = createEventsRepo(ctx.run);
    const stored = await events.insert(OWNER, {
      eventType: "TRANSACTIONS",
      eventCode: "SYNC_UPDATES_AVAILABLE",
      plaidItemId: PLAID_ITEM,
      dedupKey: "dedup-direct-1",
      payload: { webhook_type: "TRANSACTIONS" },
    });
    const sync = createSyncService({ plaid: t.plaid, repo: ctx.syncRepo, decrypt: fakeDecrypt });
    const proc = createEventProcessor({ events, repo: ctx.syncRepo, sync });
    expect(await proc.process(OWNER, stored.id)).toBe("processed");
    expect(await proc.process(OWNER, stored.id)).toBe("already_processed");
    expect(transactionsSync).toHaveBeenCalledTimes(1);
  });

  it("applies ITEM events to our own tables: reauth, repair and revoke", async () => {
    const owner = "owner-item-events";
    await seedItem(ctx, owner, "pi-ev", [account("pa-ev")]);
    const events = createEventsRepo(ctx.run);
    const sync = createSyncService({
      plaid: fakePlaid({
        getAccounts: vi.fn(async () => [accountInfo("pa-ev")]),
        transactionsSync: vi.fn(async () => page({ nextCursor: "e1" })),
      }),
      repo: ctx.syncRepo,
      decrypt: fakeDecrypt,
    });
    const proc = createEventProcessor({ events, repo: ctx.syncRepo, sync });
    const status = async () =>
      (await ctx.run(owner, async (tx) => (await tx.query<{ status: string }>("SELECT status FROM items")).rows))[0].status;
    let n = 0;
    const fire = async (type: string, code: string, error_code?: string) => {
      const s = await events.insert(owner, {
        eventType: type,
        eventCode: code,
        plaidItemId: "pi-ev",
        dedupKey: `ev-${n++}`,
        payload: error_code ? { error_code } : {},
      });
      return proc.process(owner, s.id);
    };

    await fire("ITEM", "ERROR", "ITEM_LOGIN_REQUIRED");
    expect(await status()).toBe("needs_reauth");
    await fire("ITEM", "LOGIN_REPAIRED");
    expect(await status()).toBe("active");
    await fire("ITEM", "PENDING_EXPIRATION");
    expect(await status()).toBe("needs_reauth");
    await fire("ITEM", "ERROR", "SOMETHING_ELSE");
    expect(await status()).toBe("needs_reauth");
    await fire("ITEM", "USER_PERMISSION_REVOKED");
    expect(await status()).toBe("revoked");
    // A revoked Item is not resurrected by a stray repair event.
    await fire("ITEM", "LOGIN_REPAIRED");
    expect(await status()).toBe("revoked");
  });

  it("records a short error code and leaves processed_at null when processing fails, so a redelivery retries", async () => {
    const owner = "owner-retry";
    await seedItem(ctx, owner, "pi-retry", [account("pa-retry")]);
    let fail = true;
    const plaid = fakePlaid({
      getAccounts: vi.fn(async () => [accountInfo("pa-retry")]),
      transactionsSync: vi.fn(async () => {
        if (fail) throw new (await import("@/server/plaid/errors")).PlaidApiError("RATE_LIMIT");
        return page({ nextCursor: "ok" });
      }),
    });
    const events = createEventsRepo(ctx.run);
    const sync = createSyncService({ plaid, repo: ctx.syncRepo, decrypt: fakeDecrypt });
    const proc = createEventProcessor({ events, repo: ctx.syncRepo, sync });
    const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "pi-retry" });
    const pending: Promise<void>[] = [];
    const deps: WebhookDeps = {
      verify: async () => true,
      repo: ctx.syncRepo,
      events,
      process: (o, e) => proc.process(o, e),
      schedule: (w) => void pending.push(w()),
    };
    await handlePlaidWebhook(request(body, "x"), deps);
    await Promise.all(pending);
    const row = async () => (await ctx.run(owner, async (tx) => (await tx.query<{ error: string | null; processed_at: Date | null }>("SELECT error, processed_at FROM provider_events")).rows))[0];
    expect(await row()).toMatchObject({ error: "RATE_LIMIT", processed_at: null });

    fail = false;
    await handlePlaidWebhook(request(body, "x"), deps);
    await Promise.all(pending);
    expect(await row()).toMatchObject({ error: null });
    expect((await row()).processed_at).not.toBeNull();
  });

  it("acknowledges but drops events for an unknown Item or without an item id", async () => {
    const t = makeDeps();
    const unknown = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "pi-nobody" });
    const noItem = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" });
    for (const b of [unknown, noItem]) {
      const res = await handlePlaidWebhook(request(b, await sign(b)), t.deps);
      expect(res.status).toBe(200);
    }
    expect(t.processSpy).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before verifying", async () => {
    const t = makeDeps();
    const verify = vi.spyOn(t.deps, "verify");
    const res = await handlePlaidWebhook(request("x".repeat(200_000), "t"), t.deps);
    expect(res.status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });
});
