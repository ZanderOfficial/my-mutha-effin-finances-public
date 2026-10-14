import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TokenCryptoError,
  currentKeyVersion,
  decryptToken,
  encryptToken,
} from "./tokens";

const newKey = () => randomBytes(32).toString("base64");
// Synthetic string that only exists in this test file.
const sample = "synthetic-token-for-test-only";

describe("token encryption", () => {
  it("round-trips", () => {
    const env = { TOKEN_ENC_KEY: newKey() };
    const { ciphertext, keyVersion } = encryptToken(sample, env);
    expect(keyVersion).toBe(1);
    expect(ciphertext[0]).toBe(1);
    expect(decryptToken(ciphertext, env)).toBe(sample);
  });

  it("never contains the plaintext and differs per encryption", () => {
    const env = { TOKEN_ENC_KEY: newKey() };
    const a = encryptToken(sample, env).ciphertext;
    const b = encryptToken(sample, env).ciphertext;
    expect(a.equals(b)).toBe(false);
    expect(a.includes(Buffer.from(sample))).toBe(false);
  });

  it("detects tampering in every region", () => {
    const env = { TOKEN_ENC_KEY: newKey() };
    const { ciphertext } = encryptToken(sample, env);
    for (const index of [1, 13, 29, ciphertext.length - 1]) {
      const bad = Buffer.from(ciphertext);
      bad[index] ^= 0x01;
      expect(() => decryptToken(bad, env)).toThrow(TokenCryptoError);
    }
  });

  it("fails with the wrong key without echoing input", () => {
    const { ciphertext } = encryptToken(sample, { TOKEN_ENC_KEY: newKey() });
    try {
      decryptToken(ciphertext, { TOKEN_ENC_KEY: newKey() });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(sample);
      expect((e as Error).message).toBe("Could not decrypt token");
    }
  });

  it("rejects truncated input", () => {
    const env = { TOKEN_ENC_KEY: newKey() };
    expect(() => decryptToken(Buffer.alloc(10), env)).toThrow(TokenCryptoError);
  });

  it("throws on bad or missing key material", () => {
    const short = randomBytes(16).toString("base64");
    expect(() => encryptToken(sample, { TOKEN_ENC_KEY: short })).toThrow(TokenCryptoError);
    expect(() => encryptToken(sample, { TOKEN_ENC_KEY: "not base64 !!" })).toThrow(
      TokenCryptoError,
    );
    expect(() => encryptToken(sample, {})).toThrow(TokenCryptoError);
  });

  it("supports rotation: old versions still decrypt", () => {
    const k1 = newKey();
    const k2 = newKey();
    const old = encryptToken(sample, { TOKEN_ENC_KEY: k1 }).ciphertext;
    const env = {
      TOKEN_ENC_KEY: k1,
      TOKEN_ENC_KEY_V2: k2,
      TOKEN_ENC_KEY_CURRENT_VERSION: "2",
    };
    expect(currentKeyVersion(env)).toBe(2);
    const fresh = encryptToken(sample, env);
    expect(fresh.keyVersion).toBe(2);
    expect(fresh.ciphertext[0]).toBe(2);
    expect(decryptToken(old, env)).toBe(sample);
    expect(decryptToken(fresh.ciphertext, env)).toBe(sample);
  });

  it("fails when the key for a ciphertext's version is gone", () => {
    const env = { TOKEN_ENC_KEY: newKey(), TOKEN_ENC_KEY_V2: newKey() };
    const v2 = encryptToken(sample, env, 2).ciphertext;
    expect(() => decryptToken(v2, { TOKEN_ENC_KEY: env.TOKEN_ENC_KEY })).toThrow(
      TokenCryptoError,
    );
  });
});
