import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getOwnerId = vi.fn<() => Promise<string | null>>();
const SECRET_TEXT = "postgres://user:hunter2@host/db access-sandbox-0000 balance 1234.56";

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
vi.mock("@/server/auth", () => ({ getOwnerId: () => getOwnerId() }));
vi.mock("@/server/webhooks/plaid-webhook", () => ({
  handlePlaidWebhook: async () => {
    throw new Error(SECRET_TEXT);
  },
}));
vi.mock("@/server/webhooks", () => ({ getWebhookDeps: () => ({}) }));
vi.mock("@/server/sync", () => ({
  getSnapshotRunner: () => {
    throw new Error(SECRET_TEXT);
  },
}));
vi.mock("next/server", () => ({ after: () => undefined }));

import { InstitutionServiceError } from "@/server/institutions/service";
import { PlaidApiError } from "@/server/plaid/errors";
import { POST as webhook } from "@/app/api/webhooks/plaid/route";
import { GET as cron } from "@/app/api/cron/snapshot/route";
import { ownerRoute } from "./owner-route";

let errorLog: ReturnType<typeof vi.fn>;
beforeEach(() => {
  getOwnerId.mockResolvedValue("owner-1");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {}) as unknown as ReturnType<typeof vi.fn>;
  process.env.CRON_SECRET = "cron-secret-for-this-test";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
});

/** Neither the response nor any log line may carry the exception's text. */
function expectNoLeak(body: string) {
  const everything = body + errorLog.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
  expect(everything).not.toMatch(/hunter2|access-sandbox|1234\.56|postgres/);
}

describe("error responses are generic", () => {
  it("ownerRoute turns an unexpected throw into a fixed 500", async () => {
    const res = await ownerRoute(async () => {
      throw new Error(SECRET_TEXT);
    });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "Something went wrong" });
    expectNoLeak(body);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("ownerRoute reports a Plaid failure by our own text and the error code only", async () => {
    const res = await ownerRoute(async () => {
      throw new InstitutionServiceError("plaid", new PlaidApiError("RATE_LIMIT", 429).message, new PlaidApiError("RATE_LIMIT", 429));
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Plaid is rate limiting requests. Try again shortly.",
      code: "RATE_LIMIT",
    });
  });

  it("a signed-out caller gets 401 and no log line", async () => {
    getOwnerId.mockResolvedValue(null);
    const res = await ownerRoute(async () => new Response("never"));
    expect(res.status).toBe(401);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("the webhook route answers 500 with fixed text", async () => {
    const res = await webhook(new Request("http://localhost/api/webhooks/plaid", { method: "POST", body: "{}" }));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "Something went wrong" });
    expectNoLeak(body);
  });

  it("the cron route answers 500 with fixed text", async () => {
    const res = await cron(
      new Request("http://localhost/api/cron/snapshot", {
        headers: { authorization: "Bearer cron-secret-for-this-test" },
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "Something went wrong" });
    expectNoLeak(body);
  });
});
