/**
 * Pure helpers for Plaid Link's OAuth redirect flow (plaid.com/docs/link/oauth/).
 *
 * Many large US banks authenticate on their own site. Link sends the browser
 * there, the bank sends it back to our registered `redirect_uri` with an
 * `oauth_state_id` query parameter, and the page at that address must reopen
 * Link with the SAME link token and `receivedRedirectUri` set to the full URL
 * it received. So the link token has to survive one full-page navigation.
 *
 * Plaid's own example keeps it in `localStorage`. We do the same, for two
 * reasons: it is the documented approach, and on a phone the bank's app can
 * hand the user back in a different tab, where `sessionStorage` would be
 * empty. What is stored is the short-lived link token (not the access token;
 * Plaid expires link tokens after hours and Link refuses one that is already
 * used), our own Item id when reconnecting, and a timestamp. We discard the
 * record after 30 minutes and clear it the moment Link finishes. Nothing here
 * logs, and the storage object is injected so tests never touch a browser.
 */

/** The path the registered redirect URI must have; it is the OAuth return page. */
export const OAUTH_RETURN_PATH = "/oauth/plaid";

export const LINK_SESSION_KEY = "mmff.plaid.link";

/** A bank sign-in that takes longer than this is treated as abandoned. */
export const LINK_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LinkSession =
  | { kind: "new"; token: string; savedAt: number }
  | { kind: "update"; token: string; itemId: string; savedAt: number };

export type LinkSessionInput =
  | { kind: "new"; token: string }
  | { kind: "update"; token: string; itemId: string };

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9._-]{10,300}$/;

/** Best effort: private windows and blocked storage throw, and Link still works without it. */
export function saveLinkSession(
  storage: StorageLike,
  input: LinkSessionInput,
  now: number,
): boolean {
  try {
    storage.setItem(LINK_SESSION_KEY, JSON.stringify({ ...input, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function clearLinkSession(storage: StorageLike): void {
  try {
    storage.removeItem(LINK_SESSION_KEY);
  } catch {
    // Nothing to do; there is nothing sensitive to leave behind.
  }
}

/**
 * Reads the stored session. Returns null (and clears the record) when it is
 * absent, malformed, from the future or older than the maximum age.
 */
export function loadLinkSession(
  storage: StorageLike,
  now: number,
  maxAgeMs: number = LINK_SESSION_MAX_AGE_MS,
): LinkSession | null {
  let raw: string | null;
  try {
    raw = storage.getItem(LINK_SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const session = parseLinkSession(raw);
  if (!session || session.savedAt > now || now - session.savedAt > maxAgeMs) {
    clearLinkSession(storage);
    return null;
  }
  return session;
}

function parseLinkSession(raw: string): LinkSession | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.token !== "string" || !TOKEN.test(o.token)) return null;
  if (typeof o.savedAt !== "number" || !Number.isFinite(o.savedAt)) return null;
  if (o.kind === "new") return { kind: "new", token: o.token, savedAt: o.savedAt };
  if (o.kind === "update" && typeof o.itemId === "string" && ITEM_ID.test(o.itemId)) {
    return { kind: "update", token: o.token, itemId: o.itemId, savedAt: o.savedAt };
  }
  return null;
}

/** True when the URL is the bank handing the user back (it carries `oauth_state_id`). */
export function isOAuthReturn(href: string): boolean {
  try {
    const id = new URL(href).searchParams.get("oauth_state_id");
    return id !== null && id.trim() !== "";
  } catch {
    return false;
  }
}

export type OAuthResume =
  | { status: "resume"; session: LinkSession; receivedRedirectUri: string }
  /** Not a bank redirect (the page was opened directly or the state id is gone). */
  | { status: "not_oauth" }
  /** A bank redirect, but no usable stored link token: expired, cleared or another browser. */
  | { status: "missing" };

/**
 * Decides what the return page does. `receivedRedirectUri` is the full
 * current URL, exactly as Plaid requires, and is only produced for a URL that
 * carries an `oauth_state_id`; the stored link token must be present and fresh.
 */
export function resolveOAuthReturn(
  storage: StorageLike,
  href: string,
  now: number,
): OAuthResume {
  if (!isOAuthReturn(href)) return { status: "not_oauth" };
  const session = loadLinkSession(storage, now);
  if (!session) return { status: "missing" };
  return { status: "resume", session, receivedRedirectUri: href };
}

export type CompletionRequest = {
  url: string;
  /** JSON body, or undefined for a bodyless POST. */
  body?: { public_token: string; institution?: { name: string; institution_id: string } };
};

/**
 * The one server call that finishes a Link session: a new link exchanges the
 * one-time public token; reconnecting an Item (update mode) has no token to
 * exchange and just asks the server to re-read the Item.
 */
export function completionRequest(
  session: { kind: "new" } | { kind: "update"; itemId: string },
  publicToken: string | null,
  institution?: { name: string; institution_id: string } | null,
): CompletionRequest | null {
  if (session.kind === "update") {
    if (!ITEM_ID.test(session.itemId)) return null;
    return { url: `/api/plaid/items/${session.itemId}/refresh` };
  }
  if (!publicToken) return null;
  return {
    url: "/api/plaid/exchange",
    body: { public_token: publicToken, ...(institution ? { institution } : {}) },
  };
}
