import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reencryptToken } from "./rekey";
import { TokenCryptoError, decryptToken, encryptToken } from "./tokens";

const newKey = () => randomBytes(32).toString("base64");
// Synthetic string that only exists in this test file.
const sample = "synthetic-token-for-rekey-test";

function setup() {
  const k1 = newKey();
  const k2 = newKey();
  const old = encryptToken(sample, { TOKEN_ENC_KEY: k1 }).ciphertext;
  const env = { TOKEN_ENC_KEY: k1, TOKEN_ENC_KEY_V2: k2, TOKEN_ENC_KEY_CURRENT_VERSION: "2" };
  return { k1, k2, old, env };
}

describe("reencryptToken", () => {
  it("round-trips: the new blob decrypts to the same plaintext", () => {
    const { old, env } = setup();
    const r = reencryptToken(old, env);
    expect(decryptToken(r.ciphertext, env)).toBe(sample);
    expect(r.ciphertext.equals(Buffer.from(old))).toBe(false);
  });

  it("bumps the version to the newest and writes it in the header byte", () => {
    const { old, env } = setup();
    expect(old[0]).toBe(1);
    const r = reencryptToken(old, env);
    expect(r.keyVersion).toBe(2);
    expect(r.ciphertext[0]).toBe(2);
    expect(r.changed).toBe(true);
  });

  it("can be read with the new key alone, so the old key can be retired", () => {
    const { old, k2, env } = setup();
    const r = reencryptToken(old, env);
    expect(decryptToken(r.ciphertext, { TOKEN_ENC_KEY_V2: k2 })).toBe(sample);
  });

  it("returns a blob already on the newest version untouched", () => {
    const { env } = setup();
    const current = encryptToken(sample, env).ciphertext;
    const r = reencryptToken(current, env);
    expect(r.changed).toBe(false);
    expect(r.keyVersion).toBe(2);
    expect(r.ciphertext.equals(current)).toBe(true);
  });

  it("fails on a tampered blob", () => {
    const { old, env } = setup();
    for (const index of [1, 13, 29, old.length - 1]) {
      const bad = Buffer.from(old);
      bad[index] ^= 0x01;
      expect(() => reencryptToken(bad, env)).toThrow(TokenCryptoError);
    }
  });

  it("fails clearly when the old key is gone, naming the version and nothing else", () => {
    const { k2, old } = setup();
    const env = { TOKEN_ENC_KEY_V2: k2, TOKEN_ENC_KEY_CURRENT_VERSION: "2" };
    try {
      reencryptToken(old, env);
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(e).toBeInstanceOf(TokenCryptoError);
      expect(msg).toContain("version 1");
      expect(msg).not.toContain(sample);
      expect(msg).not.toContain(k2);
      expect(msg).not.toContain(Buffer.from(old).toString("base64"));
    }
  });

  it("fails clearly when the newest key is missing", () => {
    const { k1, old } = setup();
    const env = { TOKEN_ENC_KEY: k1, TOKEN_ENC_KEY_CURRENT_VERSION: "2" };
    expect(() => reencryptToken(old, env)).toThrow(/version 2/);
  });

  it("rejects empty and truncated input without echoing it", () => {
    const { env } = setup();
    expect(() => reencryptToken(Buffer.alloc(0), env)).toThrow(TokenCryptoError);
    expect(() => reencryptToken(Buffer.from([1, 2, 3]), env)).toThrow(TokenCryptoError);
  });
});
