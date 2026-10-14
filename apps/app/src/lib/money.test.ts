import { describe, expect, it } from "vitest";
import { formatCents, formatCentsCompact } from "./money";

// Inputs here are tiny synthetic cases that live only in this test file.
describe("formatCents", () => {
  it("renders a missing value as an em dash, not zero", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
  });

  it("renders a real zero as 0.00", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("uses a true minus sign for negatives", () => {
    expect(formatCents(-41200)).toBe("−$412.00");
  });

  it("adds a plus only when asked", () => {
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(5, { sign: true })).toBe("+$0.05");
    expect(formatCents(-5, { sign: true })).toBe("−$0.05");
  });

  it("groups thousands and keeps two decimals", () => {
    expect(formatCents(123456789)).toBe("$1,234,567.89");
  });

  it("rejects non-integers instead of rounding silently", () => {
    expect(() => formatCents(1.5)).toThrow(RangeError);
  });
});

describe("formatCents trimZeroCents", () => {
  it("drops .00 only on whole dollars", () => {
    expect(formatCents(41200, { trimZeroCents: true })).toBe("$412");
    expect(formatCents(41205, { trimZeroCents: true })).toBe("$412.05");
    expect(formatCents(0, { trimZeroCents: true })).toBe("$0");
  });
});

describe("formatCentsCompact", () => {
  it("is the full value up to seven figures of dollars", () => {
    expect(formatCentsCompact(123456789)).toBe("$1,234,567.89");
    expect(formatCentsCompact(null)).toBe("—");
  });
  it("goes compact above that, truncating", () => {
    expect(formatCentsCompact(1_234_000_000)).toBe("$12.3M");
    expect(formatCentsCompact(-1_299_000_000)).toBe("−$12.9M");
    expect(formatCentsCompact(123_456_000_000, { sign: true })).toBe("+$1.2B");
  });
});
