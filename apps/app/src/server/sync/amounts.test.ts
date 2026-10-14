import { describe, expect, it } from "vitest";
import { normaliseAmountCents } from "./amounts";

describe("normaliseAmountCents", () => {
  it("stores Plaid outflows (positive) as negative spending", () => {
    expect(normaliseAmountCents(4.5)).toBe(-450);
    expect(normaliseAmountCents(1234.56)).toBe(-123456);
  });
  it("stores Plaid inflows (negative) as positive income", () => {
    expect(normaliseAmountCents(-2000)).toBe(200000);
    expect(normaliseAmountCents(-0.01)).toBe(1);
  });
  it("is exact where float multiplication is not", () => {
    expect(normaliseAmountCents(1.005)).toBe(-101);
    expect(normaliseAmountCents(0.1 + 0.2)).toBe(-30);
  });
  it("never returns negative zero", () => {
    expect(Object.is(normaliseAmountCents(0), 0)).toBe(true);
    expect(Object.is(normaliseAmountCents(-0), 0)).toBe(true);
    expect(Object.is(normaliseAmountCents(0.001), 0)).toBe(true);
  });
  it("keeps unknown unknown", () => {
    expect(normaliseAmountCents(null)).toBeNull();
    expect(normaliseAmountCents(undefined)).toBeNull();
    expect(normaliseAmountCents(Number.NaN)).toBeNull();
  });
});
