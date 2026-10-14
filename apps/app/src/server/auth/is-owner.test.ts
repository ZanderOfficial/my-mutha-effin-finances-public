import { describe, expect, it } from "vitest";
import { isOwner } from "./is-owner";

// Synthetic addresses on a reserved test domain, only in this file.
const OWNER = "owner@example.test";

describe("isOwner", () => {
  it("accepts the owner's email", () => {
    expect(isOwner({ email: OWNER }, OWNER)).toBe(true);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(isOwner({ email: "Owner@Example.TEST " }, ` ${OWNER.toUpperCase()}`)).toBe(true);
  });

  it("rejects a different email", () => {
    expect(isOwner({ email: "someone@example.test" }, OWNER)).toBe(false);
  });

  it("does not match on substrings or lookalikes", () => {
    expect(isOwner({ email: "xowner@example.test" }, OWNER)).toBe(false);
    expect(isOwner({ email: "owner@example.test.evil" }, OWNER)).toBe(false);
    expect(isOwner({ email: "owner+tag@example.test" }, OWNER)).toBe(false);
  });

  it("is false when OWNER_EMAIL is unset, empty or blank", () => {
    expect(isOwner({ email: OWNER }, undefined)).toBe(false);
    expect(isOwner({ email: OWNER }, "")).toBe(false);
    expect(isOwner({ email: "" }, "")).toBe(false);
    expect(isOwner({ email: " " }, "  ")).toBe(false);
  });

  it("is false for a missing user or email", () => {
    expect(isOwner(null, OWNER)).toBe(false);
    expect(isOwner(undefined, OWNER)).toBe(false);
    expect(isOwner({}, OWNER)).toBe(false);
    expect(isOwner({ email: null }, OWNER)).toBe(false);
    expect(isOwner({ email: 42 }, OWNER)).toBe(false);
  });

  it("requires a verified email when the flag is exposed", () => {
    expect(isOwner({ email: OWNER, emailVerified: false }, OWNER)).toBe(false);
    expect(isOwner({ email: OWNER, emailVerified: "true" }, OWNER)).toBe(false);
    expect(isOwner({ email: OWNER, emailVerified: true }, OWNER)).toBe(true);
  });

  it("allows an absent verification flag", () => {
    expect(isOwner({ email: OWNER, emailVerified: undefined }, OWNER)).toBe(true);
    expect(isOwner({ email: OWNER, emailVerified: null }, OWNER)).toBe(true);
  });

  it("reads OWNER_EMAIL from the environment by default", () => {
    const prev = process.env.OWNER_EMAIL;
    try {
      delete process.env.OWNER_EMAIL;
      expect(isOwner({ email: OWNER })).toBe(false);
      process.env.OWNER_EMAIL = OWNER;
      expect(isOwner({ email: OWNER })).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.OWNER_EMAIL;
      else process.env.OWNER_EMAIL = prev;
    }
  });
});
