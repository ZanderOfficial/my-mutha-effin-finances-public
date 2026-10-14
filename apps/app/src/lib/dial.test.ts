import { describe, expect, it } from "vitest";
import { RING_CIRCUMFERENCE, dialFontSize, dialGeometry } from "./dial";

// Tiny synthetic inputs, defined only inside this test file.
describe("dialGeometry", () => {
  it("is null when totals are unknown so the dial stays an empty outline", () => {
    expect(dialGeometry(null, null)).toBeNull();
    expect(dialGeometry(1000, null)).toBeNull();
    expect(dialGeometry(null, 1000)).toBeNull();
  });

  it("is null when income is zero, because a ratio would be meaningless", () => {
    expect(dialGeometry(0, 500)).toBeNull();
  });

  it("fills part of the ring when under income", () => {
    const g = dialGeometry(1000, 250);
    expect(g?.filled).toBeCloseTo(RING_CIRCUMFERENCE * 0.25);
    expect(g?.overflow).toBe(0);
    expect(g?.deficitCents).toBe(-750);
  });

  it("fills the ring and marks overflow when overspent", () => {
    const g = dialGeometry(1000, 1100);
    expect(g?.filled).toBeCloseTo(RING_CIRCUMFERENCE);
    expect(g?.overflow).toBeCloseTo(RING_CIRCUMFERENCE * 0.1);
    expect(g?.deficitCents).toBe(100);
  });
});

describe("dialFontSize", () => {
  it("shrinks longer figures so they stay inside the ring", () => {
    expect(dialFontSize("$0.00")).toBe(92);
    expect(dialFontSize("−$412.00")).toBeLessThan(dialFontSize("$5.00"));
    expect(dialFontSize("−$1,234,567.00")).toBeLessThanOrEqual(46);
    expect(dialFontSize("x".repeat(100))).toBe(36);
    expect(dialFontSize("")).toBe(96);
  });
});
