import { describe, expect, it } from "vitest";
import { budgetHref, EXPENSES, LEDGER, parseBudgetView } from "./budget-views";

const ID = "00000000-0000-4000-8000-000000000001";

describe("parseBudgetView", () => {
  it("reads each sub-tab and its options, with Expenses the default", () => {
    expect(parseBudgetView({})).toEqual(EXPENSES);
    expect(parseBudgetView({ period: "annual" })).toEqual({ ...EXPENSES, period: "annual" });
    expect(parseBudgetView({ view: "income", year: "2025" })).toEqual({ kind: "income", year: 2025 });
    expect(parseBudgetView({ view: "ledger", for: "personal", period: "annual", by: "line" })).toEqual({
      kind: "planned",
      personalOnly: true,
      period: "annual",
      by: "line",
    });
    expect(parseBudgetView({ view: "business", business: ID })).toEqual({
      kind: "business",
      businessId: ID,
      period: "monthly",
      by: "category",
    });
  });

  it("opens the one-time catch-up on its own link", () => {
    expect(parseBudgetView({ view: "catch-up" })).toEqual({ kind: "catch-up" });
    expect(budgetHref({ kind: "catch-up" })).toBe("/budget?view=catch-up");
  });

  it("still opens the Ledger from an old Planned link", () => {
    expect(parseBudgetView({ view: "planned" })).toEqual(LEDGER);
  });

  it("falls back to plain choices for junk", () => {
    expect(parseBudgetView({ view: "business", business: "not-an-id" })).toEqual(EXPENSES);
    expect(parseBudgetView({ view: "limits" })).toEqual(EXPENSES);
    expect(parseBudgetView({ view: "income", year: "20x5" })).toEqual({ kind: "income", year: null });
    expect(parseBudgetView({ view: ["ledger", "income"], period: "weekly" })).toMatchObject({ kind: "planned", period: "monthly" });
  });
});

describe("budgetHref", () => {
  it("leaves defaults out and round-trips through the parser", () => {
    expect(budgetHref(EXPENSES)).toBe("/budget");
    expect(budgetHref(LEDGER)).toBe("/budget?view=ledger");
    const business = { kind: "business" as const, businessId: ID, period: "annual" as const, by: "line" as const };
    const href = budgetHref(business);
    expect(href).toBe(`/budget?view=business&business=${ID}&period=annual&by=line`);
    expect(parseBudgetView(Object.fromEntries(new URLSearchParams(href.split("?")[1])))).toEqual(business);
    const personal = { ...EXPENSES, personalOnly: true, period: "annual" as const };
    expect(parseBudgetView(Object.fromEntries(new URLSearchParams(budgetHref(personal).split("?")[1])))).toEqual(personal);
  });
});
