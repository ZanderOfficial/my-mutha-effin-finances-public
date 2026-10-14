import { describe, expect, it } from "vitest";
import { allocateBps, allocationByType, formatBps, withShares } from "./invest";
import { ratioBps } from "./ratio";

describe("allocateBps", () => {
  it("always sums to exactly 10000 by largest remainder", () => {
    for (const values of [
      [1, 1, 1],
      [1, 2, 4],
      [333, 333, 334],
      [7, 11, 13, 17, 19],
    ]) {
      const shares = allocateBps(values);
      expect(shares.reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(10000);
    }
    expect(allocateBps([1, 1, 1])).toEqual([3334, 3333, 3333]);
  });
  it("gives unknown and non-positive values no share", () => {
    expect(allocateBps([100, null, 0, -5, 100])).toEqual([5000, null, null, null, 5000]);
  });
  it("is all null with nothing to allocate", () => {
    expect(allocateBps([])).toEqual([]);
    expect(allocateBps([null, null])).toEqual([null, null]);
    expect(allocateBps([0])).toEqual([null]);
  });
});

describe("holdings", () => {
  const h = (name: string, valueCents: number | null, securityType: string | null = "equity") => ({
    name,
    ticker: null,
    securityType,
    accountName: "Brokerage",
    valueCents,
  });
  it("sorts biggest first with unknown last, and shares sum to 100 percent", () => {
    const rows = withShares([h("B", 200), h("U", null), h("A", 300), h("C", 500)]);
    expect(rows.map((r) => r.name)).toEqual(["C", "A", "B", "U"]);
    expect(rows.map((r) => r.shareBps)).toEqual([5000, 3000, 2000, null]);
  });
  it("groups the ring by security type", () => {
    const slices = allocationByType([
      h("A", 300),
      h("B", 100, "etf"),
      h("C", 100, null),
      h("D", null),
    ]);
    expect(slices.map((s) => s.label)).toEqual(["Equity", "ETF", "Other"]);
    expect(slices.reduce((a, s) => a + s.shareBps, 0)).toBe(10000);
  });
  it("formats basis points", () => {
    expect(formatBps(1234)).toBe("12.34%");
    expect(formatBps(5)).toBe("0.05%");
    expect(formatBps(null)).toBe("—");
  });
});

describe("ratioBps (utilisation)", () => {
  it("is balance over limit in basis points", () => {
    expect(ratioBps(25000, 100000)).toBe(2500);
    expect(ratioBps(150000, 100000)).toBe(15000);
    expect(ratioBps(0, 100000)).toBe(0);
  });
  it("is unknown without a positive limit", () => {
    expect(ratioBps(100, null)).toBeNull();
    expect(ratioBps(100, 0)).toBeNull();
    expect(ratioBps(null, 100)).toBeNull();
  });
});
