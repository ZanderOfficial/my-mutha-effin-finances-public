import { describe, expect, it } from "vitest";
import { historyYears, incomeByMonth, madeIn, pickYear, type IncomeDeposit } from "./income";

// Tiny synthetic deposits; they exist only in this file.
let seq = 0;
const deposit = (date: string, amountCents: number, over: Partial<IncomeDeposit> = {}): IncomeDeposit => ({
  id: `d${++seq}`,
  date,
  label: "Client",
  amountCents,
  pending: false,
  status: "income",
  businessId: null,
  ...over,
});

const year = (deposits: IncomeDeposit[], over = {}) =>
  incomeByMonth({
    year: 2026,
    today: "2026-10-07",
    historyStart: "2024-10-08",
    deposits,
    filter: { kind: "all" },
    ...over,
  });

const month = (result: ReturnType<typeof year>, key: string) => result.months.find((m) => m.month === key)!;

describe("incomeByMonth", () => {
  it("totals each month's income and the year", () => {
    const r = year([deposit("2026-01-05", 23400), deposit("2026-03-02", 25700), deposit("2026-03-20", 70500)]);
    expect(r.months).toHaveLength(12);
    expect(month(r, "2026-01").totalCents).toBe(23400);
    expect(month(r, "2026-03").totalCents).toBe(96200);
    expect(month(r, "2026-03").deposits.map((d) => d.amountCents)).toEqual([25700, 70500]);
    expect(r.totalCents).toBe(119600);
  });

  it("shows a complete month with no income as a real zero", () => {
    expect(month(year([]), "2026-02")).toMatchObject({ state: "complete", totalCents: 0 });
  });

  it("leaves future months and months before history unknown, not zero", () => {
    const r = year([], { historyStart: "2026-04-01" });
    expect(month(r, "2026-11")).toMatchObject({ state: "future", totalCents: null });
    expect(month(r, "2026-03")).toMatchObject({ state: "before_history", totalCents: null });
    expect(month(r, "2026-04")).toMatchObject({ state: "complete", totalCents: 0 });
    expect(year([], { historyStart: null }).totalCents).toBeNull();
  });

  it("marks the current month, and a month where history starts mid-way, as partial", () => {
    const r = year([deposit("2026-10-02", 100000)], { historyStart: "2026-02-15" });
    expect(month(r, "2026-10")).toMatchObject({ state: "partial", totalCents: 100000 });
    expect(month(r, "2026-02")).toMatchObject({ state: "partial", totalCents: 0 });
  });

  it("picks the high and low months and the average from complete months only", () => {
    const r = year([
      deposit("2026-05-10", 364900),
      deposit("2026-01-10", 23400),
      deposit("2026-10-01", 999999), // partial month: not the high, not in the average
    ], { historyStart: "2026-01-01" });
    expect(r.highestMonth).toBe("2026-05");
    // February to April, June to September are complete months with no income.
    expect(r.lowestMonth).toBe("2026-02");
    expect(r.averageCents).toBe(43144); // (23400 + 364900) / 9, rounded
  });

  it("counts only income in totals, and tallies unsorted deposits per month", () => {
    const r = year([
      deposit("2026-06-01", 50000),
      deposit("2026-06-02", 40000, { status: "unsorted" }),
      deposit("2026-06-03", 30000, { status: "not_income" }),
    ]);
    expect(month(r, "2026-06")).toMatchObject({ totalCents: 50000, unsortedCount: 1 });
    expect(month(r, "2026-06").deposits).toHaveLength(1);
  });

  it("filters by personal or by one business", () => {
    const deposits = [
      deposit("2026-07-01", 10000),
      deposit("2026-07-02", 20000, { businessId: "biz-1" }),
      deposit("2026-07-03", 40000, { businessId: "biz-2" }),
    ];
    expect(month(year(deposits, { filter: { kind: "personal" } }), "2026-07").totalCents).toBe(10000);
    expect(month(year(deposits, { filter: { kind: "business", businessId: "biz-1" } }), "2026-07").totalCents).toBe(20000);
    expect(month(year(deposits), "2026-07").totalCents).toBe(70000);
  });
});

describe("year switcher", () => {
  it("offers every year from the first synced one to this one", () => {
    expect(historyYears("2024-10-08", "2026-10-07")).toEqual([2024, 2025, 2026]);
    expect(historyYears("2026-02-01", "2026-10-07")).toEqual([2026]);
    expect(historyYears(null, "2026-10-07")).toEqual([]);
  });

  it("keeps a year it offers and falls back to this year otherwise", () => {
    expect(pickYear(2025, [2024, 2025, 2026], "2026-10-07")).toBe(2025);
    expect(pickYear(1999, [2024, 2025, 2026], "2026-10-07")).toBe(2026);
    expect(pickYear(null, [], "2026-10-07")).toBe(2026);
  });
});

describe("madeIn", () => {
  it("reads this month's total for Monthly and the year so far for Annual, and null without income", () => {
    const year = incomeByMonth({
      year: 2026,
      today: "2026-03-10",
      historyStart: "2026-01-01",
      deposits: [
        { id: "a", date: "2026-02-03", label: "Client", amountCents: 500, pending: false, status: "income", businessId: null },
        { id: "b", date: "2026-03-04", label: "Client", amountCents: 200, pending: false, status: "income", businessId: null },
      ],
      filter: { kind: "all" },
    });
    expect(madeIn(year, "monthly", "2026-03-10")).toBe(200);
    expect(madeIn(year, "annual", "2026-03-10")).toBe(700);
    expect(madeIn(null, "monthly", "2026-03-10")).toBeNull();
  });
});
