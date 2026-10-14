import { describe, expect, it } from "vitest";
import {
  chartLine,
  chartSummary,
  parseRange,
  rangeDelta,
  rangeStartDate,
  splitAccounts,
} from "./networth";

const s = (date: string, netWorthCents: number) => ({ date, netWorthCents });

describe("ranges", () => {
  it("parses the query param and falls back", () => {
    expect(parseRange("1Y")).toBe("1Y");
    expect(parseRange(["All", "1M"])).toBe("All");
    expect(parseRange("nonsense")).toBe("6M");
    expect(parseRange(undefined)).toBe("6M");
  });
  it("finds each range start, and All has none", () => {
    expect(rangeStartDate("2026-06-13", "1M")).toBe("2026-05-13");
    expect(rangeStartDate("2026-06-13", "6M")).toBe("2025-12-13");
    expect(rangeStartDate("2026-06-13", "1Y")).toBe("2025-06-13");
    expect(rangeStartDate("2026-06-13", "All")).toBeNull();
  });
});

describe("rangeDelta", () => {
  it("is last minus first", () => {
    expect(
      rangeDelta([s("2026-01-01", 1000), s("2026-01-02", 5000), s("2026-01-03", 700)]),
    ).toEqual({
      fromDate: "2026-01-01",
      toDate: "2026-01-03",
      fromCents: 1000,
      toCents: 700,
      deltaCents: -300,
    });
  });
  it("is null with fewer than two points, not zero", () => {
    expect(rangeDelta([])).toBeNull();
    expect(rangeDelta([s("2026-01-01", 1000)])).toBeNull();
  });
});

describe("chartLine", () => {
  it("is null for no data", () => {
    expect(chartLine([], 100, 50, 5)).toBeNull();
  });
  it("puts the lowest point at the bottom and the highest at the top", () => {
    const c = chartLine([s("2026-01-01", 0), s("2026-01-02", 100)], 110, 60, 5);
    expect(c?.d).toBe("M5 55 L105 5");
    expect(c?.last).toEqual({ x: 105, y: 5 });
  });
  it("spaces points by calendar day", () => {
    const c = chartLine(
      [s("2026-01-01", 0), s("2026-01-02", 50), s("2026-01-11", 100)],
      110,
      60,
      5,
    );
    expect(c?.d).toContain("L15 ");
  });
  it("draws a flat series mid-height and one point as a dot", () => {
    expect(chartLine([s("2026-01-01", 5), s("2026-01-02", 5)], 100, 50, 0)?.d).toBe(
      "M0 25 L100 25",
    );
    expect(chartLine([s("2026-01-01", 5)], 100, 50, 0)?.d).toBe("M50 25h0");
  });
});

describe("chartSummary", () => {
  it("says what happened, with real numbers", () => {
    const series = [s("2026-01-01", 100000), s("2026-02-01", 125050)];
    expect(chartSummary(series, rangeDelta(series))).toBe(
      "Net worth went from $1,000.00 on 2026-01-01 to $1,250.50 on 2026-02-01, a change of +$250.50.",
    );
  });
  it("handles one point and none", () => {
    expect(chartSummary([], null)).toBe("No net worth history yet.");
    expect(chartSummary([s("2026-01-01", 100)], null)).toContain("One day of history");
  });
});

describe("splitAccounts", () => {
  it("separates assets from liabilities", () => {
    const r = splitAccounts([
      { isLiability: false, balanceCents: 1 },
      { isLiability: true, balanceCents: 2 },
    ]);
    expect(r.assets).toHaveLength(1);
    expect(r.liabilities).toHaveLength(1);
  });
});
