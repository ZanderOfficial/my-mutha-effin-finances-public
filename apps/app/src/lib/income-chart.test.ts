import { describe, expect, it } from "vitest";
import { axisLabel, barReadout, chartSummary, incomeChart, smoothPath, threeMonthAverages, type ChartBar } from "./income-chart";
import { incomeByMonth, type IncomeDeposit } from "./income";

// Tiny synthetic deposits; they exist only in this file.
let seq = 0;
const deposit = (date: string, amountCents: number): IncomeDeposit => ({
  id: `d${++seq}`,
  date,
  label: "Client",
  amountCents,
  pending: false,
  status: "income",
  businessId: null,
});

const year = (deposits: IncomeDeposit[], historyStart: string | null = "2026-01-01") =>
  incomeByMonth({ year: 2026, today: "2026-06-10", historyStart, deposits, filter: { kind: "all" } });

const SAMPLE = year([
  deposit("2026-01-05", 100000),
  deposit("2026-02-05", 300000),
  deposit("2026-03-05", 200000),
  deposit("2026-04-05", 50000),
  deposit("2026-05-05", 250000),
  deposit("2026-06-02", 40000),
]);

describe("incomeChart", () => {
  it("draws complete and partial months and leaves future months unknown", () => {
    const { bars } = incomeChart(SAMPLE);
    expect(bars.map((b) => b.kind)).toEqual([
      "complete", "complete", "complete", "complete", "complete", "partial",
      "unknown", "unknown", "unknown", "unknown", "unknown", "unknown",
    ]);
    expect(bars[6]).toMatchObject({ totalCents: null, share: null });
  });

  it("scales to a round number above the highest month", () => {
    const chart = incomeChart(SAMPLE);
    expect(chart.ticks.map((t) => t.cents)).toEqual([0, 250000, 500000]);
    expect(chart.bars[1].share).toBe(0.6);
  });

  it("marks the highest and lowest complete months, never the partial one", () => {
    const marks = incomeChart(SAMPLE).bars.map((b) => b.mark);
    expect(marks[1]).toBe("high");
    expect(marks[3]).toBe("low");
    expect(marks[5]).toBeNull();
  });

  it("draws an average line and a trend only from complete months", () => {
    const chart = incomeChart(SAMPLE);
    expect(chart.averageShare).toBe(0.36); // 180000 of 500000
    expect(chart.trendPath).toMatch(/^M50 /);
    expect(chart.trendPath).not.toContain("NaN");
  });

  it("draws nothing it does not know: no scale, no average, no trend", () => {
    const chart = incomeChart(year([], null));
    expect(chart.ticks).toEqual([]);
    expect(chart.averageShare).toBeNull();
    expect(chart.trendPath).toBeNull();
    expect(chart.bars.every((b) => b.share === null && b.mark === null)).toBe(true);
    expect(chart.summary).toBe("No income history for 2026 yet.");
  });

  it("keeps a known month with no income as a real zero", () => {
    const chart = incomeChart(year([deposit("2026-03-05", 50000)]));
    expect(chart.bars[0]).toMatchObject({ kind: "complete", totalCents: 0, share: 0 });
  });
});

describe("threeMonthAverages", () => {
  it("averages each complete month with its complete neighbours", () => {
    expect(threeMonthAverages(SAMPLE.months)).toEqual([
      { index: 0, cents: 200000 },
      { index: 1, cents: 200000 },
      { index: 2, cents: 183333 },
      { index: 3, cents: 166667 },
      { index: 4, cents: 150000 },
    ]);
  });
});

describe("smoothPath", () => {
  it("passes through every point and never overshoots a flat stretch", () => {
    const path = smoothPath([{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(path).toBe("M0 10 C3.3 10 6.7 10 10 10 C13.3 10 16.7 3.3 20 0");
  });
});

describe("axisLabel", () => {
  it("shortens without rounding up", () => {
    expect(axisLabel(0)).toBe("$0");
    expect(axisLabel(50000)).toBe("$500");
    expect(axisLabel(250000)).toBe("$2.5k");
    expect(axisLabel(1000000)).toBe("$10k");
    expect(axisLabel(150000000)).toBe("$1.5M");
  });
});

describe("chartSummary", () => {
  it("says the total, the high and low months, the average and what is partial", () => {
    expect(chartSummary(SAMPLE)).toBe(
      "Income in 2026: $9,400. Highest complete month February, $3,000. Lowest April, $500. " +
        "Average $1,800 a month over 5 complete months. June is partial.",
    );
  });
});

describe("barReadout", () => {
  const bar = (over: Partial<ChartBar>): ChartBar => ({
    month: "2026-05",
    kind: "complete",
    totalCents: 465_800,
    share: 0.9,
    mark: null,
    ...over,
  });

  it("names the month and its full total in dollars and cents", () => {
    expect(barReadout(bar({}))).toEqual({ month: "May 2026", amount: "$4,658.00", note: null });
  });

  it("says which complete months are the highest and lowest", () => {
    expect(barReadout(bar({ mark: "high" })).note).toBe("Highest complete month");
    expect(barReadout(bar({ mark: "low" })).note).toBe("Lowest complete month");
  });

  it("marks a partial month as so far", () => {
    expect(barReadout(bar({ kind: "partial", mark: null })).note).toBe("So far");
  });

  it("shows a real zero as $0.00 and an unknown month as a dash", () => {
    expect(barReadout(bar({ totalCents: 0, share: 0 })).amount).toBe("$0.00");
    expect(barReadout(bar({ kind: "unknown", totalCents: null, share: null }))).toEqual({
      month: "May 2026",
      amount: "—",
      note: "No data",
    });
  });
});
