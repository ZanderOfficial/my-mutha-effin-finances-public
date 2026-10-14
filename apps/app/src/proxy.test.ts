import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));

type Middleware = (req: NextRequest) => Promise<NextResponse>;
const middleware = vi.fn<Middleware>();
const getNeonAuth = vi.fn<() => { middleware: () => Middleware } | null>(() => null);
vi.mock("@/server/auth/neon", () => ({ getNeonAuth: () => getNeonAuth() }));

import { config, proxy } from "./proxy";

// The matcher is a path regular expression; anchoring it reproduces how Next
// applies it to a request path.
const matcher = new RegExp(`^${config.matcher[0]}$`);
const matched = (path: string) => matcher.test(path);

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3100"));
/** What NextResponse.next() forwards to the page as a request header. */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
const scriptSrc = (csp: string | null) =>
  (csp ?? "").split("; ").find((d) => d.startsWith("script-src ")) ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  getNeonAuth.mockReturnValue(null);
});

describe("proxy matcher", () => {
  it("runs on the app screens, the owner JSON routes and the OAuth return page", () => {
    for (const p of ["/", "/institutions", "/budget", "/oauth/plaid", "/api/plaid/exchange"]) {
      expect(matched(p)).toBe(true);
    }
  });

  it("runs on the sign-in pages too, so they get a nonce", () => {
    expect(matched("/auth/sign-in")).toBe(true);
    expect(matched("/auth/reset")).toBe(true);
  });

  it("skips the auth handler, webhooks, cron and static assets", () => {
    for (const p of [
      "/api/auth/get-session",
      "/api/webhooks/plaid",
      "/api/cron/snapshot",
      "/_next/static/chunk.js",
      "/favicon.ico",
    ]) {
      expect(matched(p)).toBe(false);
    }
  });
});

describe("proxy", () => {
  it("serves the sign-in page without the gate, with a nonce in the policy and the request", async () => {
    const res = await proxy(req("/auth/sign-in"));
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy");
    const nonce = forwarded(res, "x-nonce");
    expect(nonce).toBeTruthy();
    expect(scriptSrc(csp)).toContain(`'nonce-${nonce}'`);
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    // Next reads the nonce from the policy on the request while rendering.
    expect(forwarded(res, "content-security-policy")).toBe(csp);
    expect(getNeonAuth).not.toHaveBeenCalled();
  });

  it("uses a different nonce on every request", async () => {
    const a = forwarded(await proxy(req("/auth/sign-in")), "x-nonce");
    const b = forwarded(await proxy(req("/auth/sign-in")), "x-nonce");
    expect(a).not.toBe(b);
  });

  it("fails closed without auth: protected pages redirect to sign-in, still with a policy", async () => {
    const res = await proxy(req("/overview"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3100/auth/sign-in");
    expect(res.headers.get("content-security-policy")).toContain("'nonce-");
  });

  it("hands Neon Auth a request that already carries the nonce, so it reaches the page", async () => {
    middleware.mockImplementation(async (r) =>
      NextResponse.next({ request: { headers: new Headers(r.headers) } }),
    );
    getNeonAuth.mockReturnValue({ middleware: () => middleware });
    const res = await proxy(req("/overview"));
    const seen = middleware.mock.calls[0][0];
    const nonce = seen.headers.get("x-nonce");
    expect(nonce).toBeTruthy();
    expect(seen.nextUrl.pathname).toBe("/overview");
    expect(forwarded(res, "x-nonce")).toBe(nonce);
    expect(res.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
  });

  it("keeps the policy on a sign-in redirect from Neon Auth", async () => {
    middleware.mockResolvedValue(NextResponse.redirect("http://localhost:3100/auth/sign-in"));
    getNeonAuth.mockReturnValue({ middleware: () => middleware });
    const res = await proxy(req("/budget"));
    expect(res.status).toBe(307);
    expect(res.headers.get("content-security-policy")).toContain("'nonce-");
  });
});
