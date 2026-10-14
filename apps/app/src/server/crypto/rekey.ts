import {
  TokenCryptoError,
  assertKeyAvailable,
  currentKeyVersion,
  decryptToken,
  encryptToken,
  type Env,
} from "./tokens.ts";

// Imports in this file and in rotate-items.ts end in `.ts` on purpose: the
// rotation script (scripts/rotate-token-key.ts) runs them under Node's own
// type stripping, which does not resolve extensionless specifiers or the `@/`
// alias. Nothing else about them differs from the rest of src/server.

export type Reencrypted = {
  ciphertext: Buffer;
  keyVersion: number;
  /** False when the blob was already under the target version (it is returned untouched). */
  changed: boolean;
};

/**
 * Re-encrypts one stored access token under the newest key version.
 *
 * "Newest" is `TOKEN_ENC_KEY_CURRENT_VERSION` (default 1), the same version
 * new tokens are written with. The blob is decrypted with the version it
 * carries (its first byte), encrypted again under the newest version, and the
 * result is decrypted once more and compared with the original plaintext
 * before it is returned, so a bad key can never produce a blob that looks
 * rotated but is not. A blob already on the newest version is still decrypted
 * (to prove it is readable) and returned unchanged.
 *
 * Errors are `TokenCryptoError` with fixed text. They name a key version when
 * a key is missing, and never contain the plaintext, the ciphertext or any key
 * material.
 */
export function reencryptToken(blob: Uint8Array, keys: Env = process.env): Reencrypted {
  const target = currentKeyVersion(keys);
  const stored = Buffer.from(blob);
  if (stored.length === 0) throw new TokenCryptoError("Could not decrypt token");

  assertKeyAvailable(stored[0], keys);
  const plaintext = decryptToken(stored, keys);
  if (stored[0] === target) {
    return { ciphertext: stored, keyVersion: target, changed: false };
  }

  assertKeyAvailable(target, keys);
  const next = encryptToken(plaintext, keys, target);
  if (decryptToken(next.ciphertext, keys) !== plaintext) {
    throw new TokenCryptoError("Re-encrypted token failed verification");
  }
  return { ciphertext: next.ciphertext, keyVersion: next.keyVersion, changed: true };
}
