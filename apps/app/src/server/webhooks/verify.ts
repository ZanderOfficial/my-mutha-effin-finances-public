import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import type { PlaidWebhookKey } from "@/server/plaid/types";

/** Plaid: a webhook older than 5 minutes (by the JWT's iat) must be rejected. */
export const MAX_AGE_SECONDS = 5 * 60;
/** Tolerated clock skew for an iat slightly in the future. */
const FUTURE_SKEW_SECONDS = 60;

export type KeyFetcher = (kid: string) => Promise<PlaidWebhookKey>;

/**
 * Caches Plaid's webhook verification keys by `kid` for the life of the
 * process (keys rotate rarely; a new kid simply triggers one fetch). A key
 * whose expired_at has passed is dropped and refetched, and is refused if
 * Plaid still reports it expired.
 */
export function createKeyCache(fetchKey: KeyFetcher, nowMs: () => number = Date.now) {
  const cache = new Map<string, PlaidWebhookKey>();
  return async (kid: string): Promise<PlaidWebhookKey> => {
    const hit = cache.get(kid);
    if (hit && !(hit.expiredAt !== null && hit.expiredAt * 1000 <= nowMs())) return hit;
    const key = await fetchKey(kid);
    if (key.expiredAt !== null && key.expiredAt * 1000 <= nowMs()) {
      throw new Error("Webhook verification key has expired");
    }
    cache.set(kid, key);
    return key;
  };
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Verifies a Plaid webhook exactly as plaid.com/docs/api/webhooks/webhook-verification
 * describes: the JWT in the Plaid-Verification header must use ES256, verify
 * against the JWK for its `kid`, be no more than 5 minutes old by `iat`, and
 * its `request_body_sha256` must equal (constant-time) the SHA-256 of the RAW
 * request body. `rawBody` must be the exact text read from the request before
 * any parsing. Never throws: every failure is `false`, and nothing about the
 * token or body is logged.
 */
export async function verifyPlaidWebhook(input: {
  rawBody: string;
  token: string | null;
  getKey: (kid: string) => Promise<PlaidWebhookKey>;
  now?: Date;
}): Promise<boolean> {
  try {
    const { rawBody, token, getKey } = input;
    const now = input.now ?? new Date();
    if (!token) return false;
    const header = decodeProtectedHeader(token);
    if (header.alg !== "ES256") return false;
    if (typeof header.kid !== "string" || header.kid === "") return false;

    const k = await getKey(header.kid);
    if (k.kty !== "EC" || k.crv !== "P-256") return false;
    const jwk: JWK = { kty: k.kty, crv: k.crv, x: k.x, y: k.y, alg: "ES256", use: "sig" };
    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["ES256"],
      currentDate: now,
    });

    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (typeof payload.iat !== "number") return false;
    if (nowSeconds - payload.iat > MAX_AGE_SECONDS) return false;
    if (payload.iat - nowSeconds > FUTURE_SKEW_SECONDS) return false;

    const claimed = payload.request_body_sha256;
    if (typeof claimed !== "string") return false;
    const actual = createHash("sha256").update(rawBody, "utf8").digest("hex");
    return safeEqualHex(claimed, actual);
  } catch {
    return false;
  }
}
