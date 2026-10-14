import { describe, expect, it } from "vitest";
import {
  LINK_SESSION_KEY,
  LINK_SESSION_MAX_AGE_MS,
  clearLinkSession,
  completionRequest,
  isOAuthReturn,
  loadLinkSession,
  resolveOAuthReturn,
  saveLinkSession,
  type StorageLike,
} from "./plaid-oauth";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

// Synthetic values that exist only in this file.
const TOKEN = "link-sandbox-synthetic-0001";
const ITEM = "00000000-0000-4000-8000-000000000001";
const NOW = 1_800_000_000_000;
const RETURN =
  "https://app.example.test/oauth/plaid?oauth_state_id=11111111-2222-4333-8444-555555555555";

describe("link session storage", () => {
  it("round-trips a new-link session under one fixed key", () => {
    const s = memoryStorage();
    expect(saveLinkSession(s, { kind: "new", token: TOKEN }, NOW)).toBe(true);
    expect([...s.data.keys()]).toEqual([LINK_SESSION_KEY]);
    expect(loadLinkSession(s, NOW + 1000)).toEqual({ kind: "new", token: TOKEN, savedAt: NOW });
  });

  it("keeps the Item id for an update-mode session", () => {
    const s = memoryStorage();
    saveLinkSession(s, { kind: "update", token: TOKEN, itemId: ITEM }, NOW);
    expect(loadLinkSession(s, NOW)).toMatchObject({ kind: "update", itemId: ITEM });
  });

  it("is cleared by clearLinkSession", () => {
    const s = memoryStorage();
    saveLinkSession(s, { kind: "new", token: TOKEN }, NOW);
    clearLinkSession(s);
    expect(s.data.size).toBe(0);
    expect(loadLinkSession(s, NOW)).toBeNull();
  });

  it("discards and clears a session older than the maximum age", () => {
    const s = memoryStorage();
    saveLinkSession(s, { kind: "new", token: TOKEN }, NOW);
    expect(loadLinkSession(s, NOW + LINK_SESSION_MAX_AGE_MS)).not.toBeNull();
    expect(loadLinkSession(s, NOW + LINK_SESSION_MAX_AGE_MS + 1)).toBeNull();
    expect(s.data.size).toBe(0);
  });

  it("rejects and clears malformed or tampered records", () => {
    const bad = [
      "not json",
      "null",
      JSON.stringify({ kind: "new", token: "x", savedAt: NOW }),
      JSON.stringify({ kind: "new", token: "has spaces in the token", savedAt: NOW }),
      JSON.stringify({ kind: "update", token: TOKEN, itemId: "../etc", savedAt: NOW }),
      JSON.stringify({ kind: "other", token: TOKEN, savedAt: NOW }),
      JSON.stringify({ kind: "new", token: TOKEN, savedAt: "now" }),
      JSON.stringify({ kind: "new", token: TOKEN, savedAt: NOW + 10_000_000 }),
    ];
    for (const raw of bad) {
      const s = memoryStorage();
      s.setItem(LINK_SESSION_KEY, raw);
      expect(loadLinkSession(s, NOW)).toBeNull();
      expect(s.data.size).toBe(0);
    }
  });

  it("survives storage that throws", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    const broken: StorageLike = { getItem: blocked, setItem: blocked, removeItem: blocked };
    expect(saveLinkSession(broken, { kind: "new", token: TOKEN }, NOW)).toBe(false);
    expect(loadLinkSession(broken, NOW)).toBeNull();
    expect(() => clearLinkSession(broken)).not.toThrow();
  });
});

describe("OAuth return resolution", () => {
  it("recognises a bank redirect only by a non-empty oauth_state_id", () => {
    expect(isOAuthReturn(RETURN)).toBe(true);
    expect(isOAuthReturn("https://app.example.test/oauth/plaid")).toBe(false);
    expect(isOAuthReturn("https://app.example.test/oauth/plaid?oauth_state_id=")).toBe(false);
    expect(isOAuthReturn("not a url")).toBe(false);
  });

  it("resumes with the full current URL as receivedRedirectUri and the stored token", () => {
    const s = memoryStorage();
    saveLinkSession(s, { kind: "new", token: TOKEN }, NOW);
    const r = resolveOAuthReturn(s, RETURN, NOW + 5000);
    expect(r).toMatchObject({ status: "resume", receivedRedirectUri: RETURN });
    if (r.status === "resume") expect(r.session.token).toBe(TOKEN);
    // Resolving does not consume the record: Link clears it when it finishes.
    expect(s.data.size).toBe(1);
  });

  it("reports a missing token for a redirect with nothing stored or an expired record", () => {
    const empty = memoryStorage();
    expect(resolveOAuthReturn(empty, RETURN, NOW)).toEqual({ status: "missing" });
    const old = memoryStorage();
    saveLinkSession(old, { kind: "new", token: TOKEN }, NOW);
    expect(resolveOAuthReturn(old, RETURN, NOW + LINK_SESSION_MAX_AGE_MS + 1)).toEqual({
      status: "missing",
    });
  });

  it("does not resume when the URL is not a bank redirect, even with a stored token", () => {
    const s = memoryStorage();
    saveLinkSession(s, { kind: "new", token: TOKEN }, NOW);
    expect(resolveOAuthReturn(s, "https://app.example.test/oauth/plaid", NOW)).toEqual({
      status: "not_oauth",
    });
  });
});

describe("completionRequest", () => {
  it("exchanges the public token for a new link, sending only name and id of the institution", () => {
    expect(
      completionRequest({ kind: "new" }, "public-sandbox-synthetic-1", {
        name: "Test Bank",
        institution_id: "ins_test",
      }),
    ).toEqual({
      url: "/api/plaid/exchange",
      body: {
        public_token: "public-sandbox-synthetic-1",
        institution: { name: "Test Bank", institution_id: "ins_test" },
      },
    });
  });

  it("needs a public token for a new link", () => {
    expect(completionRequest({ kind: "new" }, null)).toBeNull();
  });

  it("re-reads the Item for update mode and never exchanges", () => {
    expect(completionRequest({ kind: "update", itemId: ITEM }, null)).toEqual({
      url: `/api/plaid/items/${ITEM}/refresh`,
    });
    expect(completionRequest({ kind: "update", itemId: "../x" }, null)).toBeNull();
  });
});
