import { describe, expect, it } from "vitest";
import { isPlaidConfigured, loadPlaidConfig } from "./config";
import { PlaidConfigError } from "./errors";

const base = { PLAID_CLIENT_ID: "test-client", PLAID_SECRET: "test-secret", PLAID_ENV: "sandbox" };

describe("loadPlaidConfig", () => {
  it("accepts sandbox", () => {
    const c = loadPlaidConfig({ ...base, PLAID_WEBHOOK_URL: "https://example.test/hook" });
    expect(c.env).toBe("sandbox");
    expect(c.webhookUrl).toBe("https://example.test/hook");
  });

  it("treats a blank webhook as none", () => {
    expect(loadPlaidConfig({ ...base, PLAID_WEBHOOK_URL: " " }).webhookUrl).toBeNull();
  });

  it("fails closed when keys are missing", () => {
    expect(() => loadPlaidConfig({ ...base, PLAID_CLIENT_ID: "" })).toThrow(PlaidConfigError);
    expect(() => loadPlaidConfig({ ...base, PLAID_SECRET: undefined })).toThrow(PlaidConfigError);
    expect(isPlaidConfigured({})).toBe(false);
  });

  it("refuses unknown or missing environments, including development", () => {
    expect(() => loadPlaidConfig({ ...base, PLAID_ENV: "development" })).toThrow(/sandbox or production/);
    expect(() => loadPlaidConfig({ ...base, PLAID_ENV: "" })).toThrow(PlaidConfigError);
    expect(() => loadPlaidConfig({ ...base, PLAID_ENV: undefined })).toThrow(PlaidConfigError);
  });

  it("refuses production without the explicit flag", () => {
    const prod = { ...base, PLAID_ENV: "production" };
    expect(() => loadPlaidConfig(prod)).toThrow(/MMFF_ALLOW_PLAID_PRODUCTION/);
    expect(() => loadPlaidConfig({ ...prod, MMFF_ALLOW_PLAID_PRODUCTION: "yes" })).toThrow(PlaidConfigError);
    expect(loadPlaidConfig({ ...prod, MMFF_ALLOW_PLAID_PRODUCTION: "true" }).env).toBe("production");
  });

  describe("PLAID_REDIRECT_URI", () => {
    const ok = "https://app.example.test/oauth/plaid";

    it("is null when unset or blank", () => {
      expect(loadPlaidConfig(base).redirectUri).toBeNull();
      expect(loadPlaidConfig({ ...base, PLAID_REDIRECT_URI: "  " }).redirectUri).toBeNull();
    });

    it("accepts a valid https URI and a sandbox localhost http URI", () => {
      expect(loadPlaidConfig({ ...base, PLAID_REDIRECT_URI: ok }).redirectUri).toBe(ok);
      expect(
        loadPlaidConfig({ ...base, PLAID_REDIRECT_URI: "http://localhost:3100/oauth/plaid" })
          .redirectUri,
      ).toBe("http://localhost:3100/oauth/plaid");
    });

    it.each([
      ["relative", "/oauth/plaid"],
      ["not a URL", "oauth plaid"],
      ["http to a real host", "http://app.example.test/oauth/plaid"],
      ["a custom scheme", "myapp://oauth/plaid"],
      ["a query string", `${ok}?a=1`],
      ["a bare question mark", `${ok}?`],
      ["a fragment", `${ok}#x`],
      ["a wildcard", "https://*.example.test/oauth/plaid"],
      ["credentials", "https://user:pw@app.example.test/oauth/plaid"],
      ["the wrong path", "https://app.example.test/callback"],
      ["a trailing slash", `${ok}/`],
    ])("refuses %s", (_name, value) => {
      expect(() => loadPlaidConfig({ ...base, PLAID_REDIRECT_URI: value })).toThrow(
        PlaidConfigError,
      );
      expect(isPlaidConfigured({ ...base, PLAID_REDIRECT_URI: value })).toBe(false);
    });

    it("refuses http even to localhost in production", () => {
      expect(() =>
        loadPlaidConfig({
          ...base,
          PLAID_ENV: "production",
          MMFF_ALLOW_PLAID_PRODUCTION: "true",
          PLAID_REDIRECT_URI: "http://localhost:3100/oauth/plaid",
        }),
      ).toThrow(/https/);
    });

    it("never echoes the value in the error", () => {
      try {
        loadPlaidConfig({ ...base, PLAID_REDIRECT_URI: "http://secret-host.test/oauth/plaid" });
      } catch (e) {
        expect(String(e)).not.toContain("secret-host");
      }
    });
  });

  it("never puts secret values in error messages", () => {
    try {
      loadPlaidConfig({ ...base, PLAID_ENV: "production" });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("test-secret");
    }
  });
});
