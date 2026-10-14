import { beforeEach, describe, expect, it, vi } from "vitest";

const getOwnerId = vi.fn<() => Promise<string | null>>();
const service = {
  startLink: vi.fn(async () => ({ linkToken: "link-test" })),
  startReconnect: vi.fn(async () => ({ linkToken: "link-update-test" })),
  completeLink: vi.fn(async () => ({
    id: "00000000-0000-4000-8000-000000000001",
    institutionName: "Test Bank",
    status: "active",
    accountCount: 1,
  })),
  refreshItem: vi.fn(async () => ({ status: "active" })),
  unlink: vi.fn(async () => undefined),
};
const getInstitutionService = vi.fn(() => service);
const countNeedsReauth = vi.fn<(owner: string) => Promise<number>>(async () => 2);
const scheduled: (() => Promise<unknown>)[] = [];
const snapshotRun = vi.fn<(owner: string) => Promise<object>>(async () => ({}));
const getSnapshotRunner = vi.fn(() => ({ snapshot: { run: snapshotRun } }));

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/server/auth", () => ({ getOwnerId: () => getOwnerId() }));
vi.mock("@/server/institutions", () => ({ getInstitutionService: () => getInstitutionService() }));
vi.mock("@/server/institutions/reads", () => ({
  institutionReads: { countNeedsReauth: (o: string) => countNeedsReauth(o) },
}));
vi.mock("@/server/sync", () => ({ getSnapshotRunner: () => getSnapshotRunner() }));
vi.mock("next/server", () => ({
  after: (work: () => Promise<unknown>) => {
    scheduled.push(work);
  },
}));

import { POST as linkToken } from "./link-token/route";
import { POST as exchange } from "./exchange/route";
import { GET as status } from "./status/route";
import { DELETE as unlink } from "./items/[itemId]/route";
import { POST as reconnect } from "./items/[itemId]/reconnect/route";
import { POST as refresh } from "./items/[itemId]/refresh/route";

const ctx = { params: Promise.resolve({ itemId: "00000000-0000-4000-8000-000000000001" }) };
const post = (body?: unknown) =>
  new Request("http://localhost/api/plaid/x", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  scheduled.length = 0;
  getOwnerId.mockResolvedValue("owner-1");
  process.env.DATABASE_URL = "postgres://placeholder.test/db";
});

describe("route auth (no owner)", () => {
  beforeEach(() => getOwnerId.mockResolvedValue(null));

  it.each([
    ["link-token", () => linkToken(post())],
    ["exchange", () => exchange(post({ public_token: "public-test-token" }))],
    ["status", () => status()],
    ["unlink", () => unlink(new Request("http://localhost/x", { method: "DELETE" }), ctx)],
    ["reconnect", () => reconnect(post(), ctx)],
    ["refresh", () => refresh(post(), ctx)],
  ])("%s answers 401 and calls nothing", async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getInstitutionService).not.toHaveBeenCalled();
    expect(countNeedsReauth).not.toHaveBeenCalled();
  });
});

describe("routes for the owner", () => {
  it("link-token returns only the link token", async () => {
    const res = await linkToken(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link_token: "link-test" });
    expect(service.startLink).toHaveBeenCalledWith("owner-1");
  });

  it("exchange validates strictly and returns safe fields only", async () => {
    const bad = await exchange(post({ public_token: "public-test-token", extra: 1 }));
    expect(bad.status).toBe(400);
    expect((await exchange(post({ public_token: "short" }))).status).toBe(400);
    expect(service.completeLink).not.toHaveBeenCalled();

    const ok = await exchange(
      post({ public_token: "public-test-token", institution: { name: "Test Bank", institution_id: "ins_test" } }),
    );
    expect(ok.status).toBe(201);
    const text = await ok.text();
    expect(text).not.toMatch(/access/i);
    expect(JSON.parse(text).item.accountCount).toBe(1);
    expect(service.completeLink).toHaveBeenCalledWith("owner-1", {
      publicToken: "public-test-token",
      institutionName: "Test Bank",
    });
  });

  it("exchange schedules the first sync after responding, and only on success", async () => {
    await exchange(post({ public_token: "short" }));
    expect(scheduled).toHaveLength(0);

    const ok = await exchange(post({ public_token: "public-test-token" }));
    expect(ok.status).toBe(201);
    // Nothing runs before the response; the work is handed to after().
    expect(snapshotRun).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(snapshotRun).toHaveBeenCalledWith("owner-1");
  });

  it("a failing first sync is logged by code, never thrown", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    getSnapshotRunner.mockImplementationOnce(() => {
      throw new Error("OWNER_TIMEZONE secret-ish detail");
    });
    await exchange(post({ public_token: "public-test-token" }));
    await expect(scheduled[0]()).resolves.toBeUndefined();
    const line = String(errorLog.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: "first_sync_failed", errorName: "Error" });
    expect(line).not.toContain("secret-ish");
    errorLog.mockRestore();
  });

  it("rejects non-empty bodies on token routes", async () => {
    expect((await linkToken(post({ products: ["auth"] }))).status).toBe(400);
    expect((await reconnect(post({ a: 1 }), ctx)).status).toBe(400);
    expect(service.startLink).not.toHaveBeenCalled();
  });

  it("reconnect, refresh and unlink pass the owner id and item id", async () => {
    expect(await (await reconnect(post(), ctx)).json()).toEqual({ link_token: "link-update-test" });
    expect(service.startReconnect).toHaveBeenCalledWith("owner-1", "00000000-0000-4000-8000-000000000001");
    expect(await (await refresh(post(), ctx)).json()).toEqual({ status: "active" });
    const del = await unlink(new Request("http://localhost/x", { method: "DELETE" }), ctx);
    expect(del.status).toBe(200);
    expect(service.unlink).toHaveBeenCalledWith("owner-1", "00000000-0000-4000-8000-000000000001");
  });

  it("status reports the count, or null when the database is not configured", async () => {
    expect(await (await status()).json()).toEqual({ needs_reauth: 2 });
    delete process.env.DATABASE_URL;
    expect(await (await status()).json()).toEqual({ needs_reauth: null });
  });

  it("answers 503 when Plaid configuration is missing (fail closed)", async () => {
    const { PlaidConfigError } = await import("@/server/plaid/errors");
    getInstitutionService.mockImplementationOnce(() => {
      throw new PlaidConfigError("PLAID_CLIENT_ID and PLAID_SECRET must be set");
    });
    const res = await linkToken(post());
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("PLAID_SECRET");
  });
});
