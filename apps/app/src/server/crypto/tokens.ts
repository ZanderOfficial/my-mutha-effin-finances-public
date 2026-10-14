import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for Plaid access tokens.
 *
 * Layout: version byte || 12-byte IV || 16-byte tag || ciphertext.
 * The version byte is the key version (1 to 255) and matches the
 * `items.key_version` column. Version 1 reads TOKEN_ENC_KEY (or
 * TOKEN_ENC_KEY_V1); version n reads TOKEN_ENC_KEY_V<n>. New tokens are
 * written with TOKEN_ENC_KEY_CURRENT_VERSION (default 1). Errors are generic
 * on purpose: they never echo plaintext, ciphertext or key material.
 */
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

export type Env = Record<string, string | undefined>;

function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > 255) {
    throw new TokenCryptoError("Invalid encryption key version");
  }
}

function loadKey(version: number, env: Env): Buffer {
  assertVersion(version);
  const raw =
    env[`TOKEN_ENC_KEY_V${version}`] ??
    (version === 1 ? env.TOKEN_ENC_KEY : undefined);
  if (!raw) throw new TokenCryptoError("Encryption key is not configured");
  const trimmed = raw.trim();
  const key = Buffer.from(trimmed, "base64");
  // Re-encoding catches stray characters Buffer.from silently skips.
  if (key.length !== KEY_LENGTH || key.toString("base64") !== trimmed) {
    throw new TokenCryptoError("Encryption key must be base64 for exactly 32 bytes");
  }
  return key;
}

/**
 * Throws a TokenCryptoError that names the key VERSION (a small integer, not
 * secret) when that version's key is missing or malformed. Lets a rotation
 * tool say "V1 is gone" instead of the generic decrypt failure. Never reads
 * out or echoes key material.
 */
export function assertKeyAvailable(version: number, env: Env = process.env): void {
  try {
    loadKey(version, env);
  } catch {
    throw new TokenCryptoError(
      `Encryption key for version ${version} is missing or invalid (TOKEN_ENC_KEY_V${version})`,
    );
  }
}

/** The key version new tokens are written with. */
export function currentKeyVersion(env: Env = process.env): number {
  const raw = env.TOKEN_ENC_KEY_CURRENT_VERSION;
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  assertVersion(n);
  return n;
}

export type EncryptedToken = { ciphertext: Buffer; keyVersion: number };

export function encryptToken(
  plaintext: string,
  env: Env = process.env,
  version: number = currentKeyVersion(env),
): EncryptedToken {
  const key = loadKey(version, env);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([Buffer.from([version]), iv, tag, body]),
    keyVersion: version,
  };
}

export function decryptToken(
  ciphertext: Uint8Array,
  env: Env = process.env,
): string {
  const buf = Buffer.from(ciphertext);
  if (buf.length < HEADER_LENGTH) {
    throw new TokenCryptoError("Could not decrypt token");
  }
  const version = buf[0];
  const iv = buf.subarray(1, 1 + IV_LENGTH);
  const tag = buf.subarray(1 + IV_LENGTH, HEADER_LENGTH);
  const body = buf.subarray(HEADER_LENGTH);
  try {
    const decipher = createDecipheriv("aes-256-gcm", loadKey(version, env), iv, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenCryptoError("Could not decrypt token");
  }
}
