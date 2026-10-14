import { describe, expect, it } from "vitest";
import { budgetActuals, type BudgetTransaction, type Placement } from "./actuals";
import { monthNeed, monthStanding, needWords, standingSentence } from "./month-standing";
import type { PlannedItem } from "./planned-budget";

// Tiny synthetic items and transactions; they exist only in this file.
const item = (id: string, amountCents: number, over: Partial<PlannedItem> = {}): PlannedItem => ({
  id,
  parentId: null,
  name: id,
  amountCents,
  frequency: "monthly",
  status: "active",
  notes: "",
  taxCategoryId: null,
  businessIds: [],
  ...over,
});

let seq = 0;
const tx = (amountCents: number, placement: Placement | null = null): BudgetTransaction => ({
  id: `t${++seq}`,
  date: "2026-10-05",
  label: "Shop",
  name: "SHOP",
  sourceKey: "shop",
  amountCents,
  pending: false,
  category: "GENERAL_MERCHANDISE",
  categoryDetail: null,
  countedAsIncome: false,
  ownTransfer: false,
  choice: placement,
  rule: null,
});

const to = (plannedItemId: string): Placement => ({ kind: "planned_item", plannedItemId });
const OUT: Placement = { kind: "out_of_budget", businessId: null, taxCategoryId: null };

// $1,000 a month of monthly items, plus $1,200 a year of annual ones: a $1,100 monthly need.
const ITEMS = [item("rent", 80000), item("food", 20000), item("insurance", 120000, { frequency: "annual" })];

const standing = (incomeCents: number | null, transactions: BudgetTransaction[], items = ITEMS, dataKnown = true) =>
  monthStanding({
    incomeCents,
    items,
    actuals: budgetActuals({
      items,
      transactions,
      startDate: "2026-10-01",
      today: "2026-10-10",
      view: "monthly",
      filter: { kind: "all" },
      lineOf: () => null,
      dataKnown,
    }),
  });

describe("monthNeed", () => {
  it("is the monthly items plus a twelfth of the annual items, rounded up to the cent", () => {
    expect(monthNeed(ITEMS)).toEqual({ monthlyCents: 100000, setAsideCents: 10000, needCents: 110000 });
    expect(monthNeed([item("domain", 1000, { frequency: "annual" })]).setAsideCents).toBe(84); // 83.33 rounds up
  });

  it("is unknown with nothing in the Ledger, and leaves out items not being paid", () => {
    expect(monthNeed([]).needCents).toBeNull();
    expect(monthNeed([...ITEMS, item("old phone", 5000, { status: "not_paying" })]).needCents).toBe(110000);
  });
});

describe("monthStanding: income minus need minus extras", () => {
  it("is short when income is below the need, even with nothing spent", () => {
    expect(standing(100000, []).standingCents).toBe(-10000);
  });

  it("is ahead when income covers the need, and spending inside the plan changes nothing", () => {
    expect(standing(150000, [tx(-15000, to("food"))])).toMatchObject({ extrasCents: 0, standingCents: 40000 });
  });

  it("takes off a line's spending beyond its plan, but not what the line has left", () => {
    expect(standing(150000, [tx(-26000, to("food"))])).toMatchObject({ extrasCents: 6000, standingCents: 34000 });
  });

  it("takes off out-of-budget and unsorted spending", () => {
    expect(standing(150000, [tx(-3000, OUT), tx(-2000)])).toMatchObject({ extrasCents: 5000, standingCents: 35000 });
  });

  it("takes off one-time spending", () => {
    const once: Placement = { kind: "one_time", businessId: null, taxCategoryId: null, oneTimeKindId: null };
    expect(standing(150000, [tx(-20000, once)])).toMatchObject({ extrasCents: 20000, standingCents: 20000 });
  });

  it("counts spending on an item not being paid as an extra", () => {
    const items = [...ITEMS, item("old phone", 5000, { status: "not_paying" })];
    expect(standing(150000, [tx(-4000, to("old phone"))], items).extrasCents).toBe(4000);
  });

  it("is unknown with nothing in the Ledger, nothing synced, or income unknown", () => {
    expect(standing(150000, [], []).standingCents).toBeNull();
    expect(standing(150000, [], ITEMS, false).standingCents).toBeNull();
    expect(standing(null, []).standingCents).toBeNull();
  });
});

describe("standingSentence and needWords", () => {
  it("says short, ahead or exactly covered, with the days left", () => {
    expect(standingSentence(-20500, 21)).toBe("$205 short with 21 days left.");
    expect(standingSentence(4000, 1)).toBe("$40 ahead with 1 day left.");
    expect(standingSentence(0, 0)).toBe("Exactly covered on the last day of the month.");
    expect(standingSentence(null, 5)).toBeNull();
  });

  it("names the monthly items and the annual set-aside", () => {
    expect(needWords(standing(0, []))).toBe("$1,000.00 of monthly items and $100.00 a month for annual ones");
    expect(needWords(standing(0, [], []))).toBeNull();
  });
});
