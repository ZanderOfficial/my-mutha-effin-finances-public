import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  createNonce,
  securityHeaderRules,
  PLAID_LINK_SCRIPT,
} from "./security-headers";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

const NONCE = createNonce();

describe("content security policy", () => {
  const prod = contentSecurityPolicy({ isDev: false, nonce: NONCE });

  it("allows exactly what Plaid Link documents and nothing else third-party", () => {
    expect(directive(prod, "script-src")).toContain(PLAID_LINK_SCRIPT);
    expect(directive(prod, "frame-src")).toBe("frame-src https://cdn.plaid.com");
    expect(directive(prod, "connect-src")).toBe(
      "connect-src 'self' https://sandbox.plaid.com https://production.plaid.com",
    );
    const origins = prod.match(/https:\/\/[^\s;]+/g) ?? [];
    expect(origins.every((o) => /^https:\/\/(cdn|sandbox|production)\.plaid\.com/.test(o))).toBe(true);
  });

  it("needs no extra source for the OAuth redirect: Link runs from the same Plaid origins", () => {
    // The return page reopens Link exactly as the main flow does (same script,
    // frame and API hosts). The bank's own site is reached by top-level
    // navigation, which no CSP directive here governs, and `form-action 'self'`
    // does not apply because Link navigates, it does not submit our forms.
    expect(directive(prod, "script-src")).toContain("https://cdn.plaid.com/");
    expect(directive(prod, "frame-src")).toContain("https://cdn.plaid.com");
    expect(prod).not.toMatch(/navigate-to/);
  });

  it("allows inline scripts only by this request's nonce, never 'unsafe-inline'", () => {
    const scripts = directive(prod, "script-src");
    expect(scripts).toContain(`'nonce-${NONCE}'`);
    expect(scripts).not.toContain("'unsafe-inline'");
    // 'strict-dynamic' would switch off the host allowlist, so the exact Plaid
    // script URL would stop being the only third-party script allowed.
    expect(scripts).not.toContain("'strict-dynamic'");
  });

  it("keeps inline styles, which the charts and Tailwind need", () => {
    expect(directive(prod, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("closes framing, plugins, base-uri and form targets", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("default-src 'self'");
  });

  it("never allows eval or wildcard sources in production", () => {
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toMatch(/\s\*[\s;]|\*$/);
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("adds eval and drops the https upgrade in development only", () => {
    const dev = contentSecurityPolicy({ isDev: true, nonce: NONCE });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("refuses a nonce that could break out of the header", () => {
    for (const bad of ["", "abc'; script-src *", "a b", "abc\r\nX-Evil: 1"]) {
      expect(() => contentSecurityPolicy({ isDev: false, nonce: bad })).toThrow();
    }
  });
});

describe("nonce", () => {
  it("is fresh base64 on every call", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // At least 128 bits before encoding.
    expect(Buffer.from(a, "base64").length).toBeGreaterThanOrEqual(16);
  });
});

describe("header rules", () => {
  const rules = securityHeaderRules();
  const all = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));

  it("applies the fixed set to every path", () => {
    expect(rules[0].source).toBe("/:path*");
    expect(all["Strict-Transport-Security"]).toMatch(/^max-age=\d{8,}; includeSubDomains$/);
    expect(all["X-Content-Type-Options"]).toBe("nosniff");
    expect(all["X-Frame-Options"]).toBe("DENY");
    expect(all["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(all["Permissions-Policy"]).toContain("camera=()");
    expect(all["Permissions-Policy"]).toContain("geolocation=()");
  });

  it("leaves the content security policy to the proxy, which has the nonce", () => {
    // A static policy here would be a second CSP header: harmless, since the
    // browser enforces both, but it would hide whether the proxy's ran.
    for (const rule of rules) {
      expect(rule.headers.map((h) => h.key)).not.toContain("Content-Security-Policy");
    }
  });

  it("marks every API response no-store", () => {
    expect(rules[1]).toEqual({
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    });
  });
});
