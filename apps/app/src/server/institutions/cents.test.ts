import { describe, expect, it } from "vitest";
import { toCents } from "./cents";

describe("toCents", () => {
  it("converts ordinary amounts exactly", () => {
    expect(toCents(0)).toBe(0);
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(1)).toBe(100);
  });

  it("avoids float error where naive multiplication fails", () => {
    expect(Math.round(1.005 * 100)).toBe(100); // the naive result is wrong
    expect(toCents(1.005)).toBe(101);
    expect(toCents(8.2)).toBe(820);
    expect(toCents(4.35)).toBe(435);
    expect(toCents(1.15)).toBe(115);
  });

  it("rounds half-cents away from zero", () => {
    expect(toCents(0.004)).toBe(0);
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-0.005)).toBe(-1);
    expect(toCents(2.994)).toBe(299);
  });

  it("handles negatives and never returns negative zero", () => {
    expect(toCents(-12.34)).toBe(-1234);
    expect(Object.is(toCents(-0.001), 0)).toBe(true);
  });

  it("handles large values", () => {
    expect(toCents(12345678.9)).toBe(1234567890);
    expect(toCents(9_000_000_000)).toBe(900_000_000_000);
  });

  it("throws rather than lose precision past the safe integer range", () => {
    expect(() => toCents(1e15)).toThrow(RangeError);
  });

  it("keeps unknown as null, never zero", () => {
    expect(toCents(null)).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
    expect(toCents(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
