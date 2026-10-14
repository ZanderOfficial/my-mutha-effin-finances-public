import { describe, expect, it } from "vitest";
import { budgetActuals, standing, type BudgetTransaction, type Placement } from "./actuals";
import type { PlannedFilter, PlannedItem, PlannedView } from "./planned-budget";

// Tiny synthetic items and transactions; they exist only in this file.
const item = (id: string, over: Partial<PlannedItem> = {}): PlannedItem => ({
  id,
  parentId: null,
  name: id,
  amountCents: 5000,
  frequency: "monthly",
  status: "active",
  notes: "",
  taxCategoryId: null,
  businessIds: [],
  ...over,
});

let seq = 0;
const tx = (amountCents: number, date: string, over: Partial<BudgetTransaction> = {}): BudgetTransaction => ({
  id: `t${String(++seq).padStart(3, "0")}`,
  date,
  label: "Shop",
  name: "SHOP",
  sourceKey: "shop",
  amountCents,
  pending: false,
  category: "GENERAL_MERCHANDISE",
  categoryDetail: null,
  countedAsIncome: false,
  ownTransfer: false,
  choice: null,
  rule: null,
  ...over,
});

const to = (plannedItemId: string): Placement => ({ kind: "planned_item", plannedItemId });
const out = (businessId: string | null = null, taxCategoryId: string | null = null): Placement => ({
  kind: "out_of_budget",
  businessId,
  taxCategoryId,
});

const ITEMS = [
  item("gym", { taxCategoryId: "health" }),
  item("utilities"),
  item("electric", { parentId: "utilities", taxCategoryId: "power" }),
  item("insurance", { frequency: "annual", businessIds: ["studio"] }),
  item("old phone", { status: "not_paying" }),
];

const actuals = (
  transactions: BudgetTransaction[],
  over: { view?: PlannedView; filter?: PlannedFilter; today?: string; startDate?: string | null; dataKnown?: boolean } = {},
) =>
  budgetActuals({
    items: ITEMS,
    transactions,
    startDate: over.startDate === undefined ? "2026-10-01" : over.startDate,
    today: over.today ?? "2026-10-20",
    view: over.view ?? "monthly",
    filter: over.filter ?? { kind: "all" },
    lineOf: (category) => (category === "health" ? "line-a" : null),
    dataKnown: over.dataKnown ?? true,
  });

describe("budgetActuals", () => {
  it("is unknown, not zero, before anything has synced or before checking starts", () => {
    expect(actuals([], { dataKnown: false })).toMatchObject({ period: null, totalCents: null, outOfBudgetCents: null });
    expect(actuals([tx(-4000, "2026-10-05", { rule: to("gym") })], { startDate: null }).totalCents).toBeNull();
    expect(actuals([]).totalCents).toBe(0);
  });

  it("matches spending by rule, and a choice beats the rule", () => {
    const result = actuals([
      tx(-4000, "2026-10-05", { rule: to("gym") }),
      tx(-2500, "2026-10-06", { rule: to("gym"), choice: out() }),
    ]);
    expect(result.actualByItem.gym).toBe(4000);
    expect(result.outOfBudgetCents).toBe(2500);
    expect(result.totalCents).toBe(6500);
  });

  it("counts one-time spending in Spent and the totals under its own tags, apart from out of budget", () => {
    const once = tx(-30000, "2026-10-07", { choice: { kind: "one_time", businessId: "studio", taxCategoryId: "health", oneTimeKindId: "meals" } });
    const result = actuals([once, tx(-2000, "2026-10-08", { choice: out() })]);
    expect(result).toMatchObject({ oneTimeCents: 30000, outOfBudgetCents: 2000, totalCents: 32000, periodSpentCents: 32000, plannedSpentCents: 0 });
    expect(result.oneTime.map((t) => t.id)).toEqual([once.id]);
    expect(result.byLine).toContainEqual({ key: "line-a", totalCents: 30000 });
    const studioOnly = actuals([once], { filter: { kind: "business", businessId: "studio" } });
    expect(studioOnly.oneTimeCents).toBe(30000);
  });

  it("never checks a transfer or a card payment, even from a matched merchant", () => {
    const result = actuals([
      tx(-9000, "2026-10-05", { rule: to("gym"), category: "TRANSFER_OUT" }),
      tx(-7000, "2026-10-05", { category: "LOAN_PAYMENTS", categoryDetail: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
    ]);
    expect(result.actualByItem.gym).toBeUndefined();
    expect(result.miscCount).toBe(0);
  });

  it("takes a refund from a matched merchant off the actual, unless it is counted as income", () => {
    const result = actuals([
      tx(-4000, "2026-10-05", { rule: to("gym") }),
      tx(1500, "2026-10-09", { rule: to("gym") }),
      tx(9900, "2026-10-10", { rule: to("gym"), countedAsIncome: true }),
    ]);
    expect(result.actualByItem.gym).toBe(2500);
  });

  it("counts a pending row", () => {
    expect(actuals([tx(-1200, "2026-10-19", { rule: to("gym"), pending: true })]).actualByItem.gym).toBe(1200);
  });

  it("rolls a sub-item's spending and charges up into its parent, and keeps a greyed-out item's matches", () => {
    const result = actuals([
      tx(-6000, "2026-10-03", { rule: to("electric") }),
      tx(-1000, "2026-10-04", { choice: to("utilities") }),
      tx(-3000, "2026-10-05", { rule: to("old phone") }),
    ]);
    expect(result.actualByItem).toMatchObject({ electric: 6000, utilities: 7000, "old phone": 3000 });
    // The parent's charges list matches its Spent figure; the sub-item's lists only its own.
    expect(result.matchedByItem.utilities.map((t) => t.amountCents)).toEqual([-1000, -6000]);
    expect(result.matchedByItem.electric.map((t) => t.amountCents)).toEqual([-6000]);
  });

  it("gives Standing only spending on paying line items, and the same view's rules", () => {
    const items = [...ITEMS, item("cable", { parentId: "old phone" })];
    const transactions = [
      tx(-4000, "2026-10-05", { rule: to("gym") }),
      tx(500, "2026-10-06", { rule: to("gym") }), // a refund still comes off
      tx(-2500, "2026-10-06", { choice: out("studio") }),
      tx(-3000, "2026-10-07", { rule: to("old phone") }),
      tx(-700, "2026-10-08", { rule: to("cable") }), // a sub-item of a not-paying item
      tx(-50000, "2026-10-09", { rule: to("insurance") }),
    ];
    const run = (view: PlannedView) =>
      budgetActuals({ items, transactions, startDate: "2026-10-01", today: "2026-10-20", view, filter: { kind: "all" }, lineOf: () => null, dataKnown: true });
    expect(run("monthly")).toMatchObject({ totalCents: 9700, plannedSpentCents: 3500 });
    expect(run("annual")).toMatchObject({ totalCents: 52500, plannedSpentCents: 50000 }); // annual items and out of budget only
    expect(actuals([], { dataKnown: false }).plannedSpentCents).toBeNull();
  });

  it("counts this month for Monthly and the whole year so far for Annual, before the start date too", () => {
    const transactions = [
      tx(-1000, "2026-08-28", { rule: to("gym") }), // before the start date, placed by the rule
      tx(-700, "2026-03-04"), // before the start date, placed nowhere
      tx(-2000, "2026-10-02", { rule: to("gym") }),
      tx(-50000, "2026-10-03", { rule: to("insurance") }),
    ];
    expect(actuals(transactions).actualByItem.gym).toBe(2000);
    expect(actuals(transactions, { startDate: "2026-09-01", today: "2026-11-02" }).actualByItem.gym).toBeUndefined();
    const annual = actuals(transactions, { view: "annual", startDate: "2026-09-01" });
    expect(annual.period).toEqual({ start: "2026-01-01", endExclusive: "2026-11-01" });
    expect(annual.actualByItem.gym).toBe(3000);
    expect(annual.totalCents).toBe(50000); // gym is monthly, so the Annual view leaves it out
    expect(annual.unsortedCents).toBe(700);
    expect(annual.periodSpentCents).toBe(53700); // gym and insurance whatever the view, plus the unsorted
    expect(actuals(transactions, { view: "annual", filter: { kind: "personal" } }).periodSpentCents).toBe(3000); // no unsorted on a filter
    expect(annual.miscCount).toBe(0); // the Misc pile still starts at the start date
  });

  it("counts a charge marked a transfer nowhere, and lists it so it can be undone", () => {
    const moved = tx(-242300, "2026-10-08", { markedTransfer: true });
    const result = actuals([moved]);
    expect(result).toMatchObject({ unsortedCents: 0, periodSpentCents: 0, miscCount: 0 });
    expect(result.transfers.map((t) => t.id)).toEqual([moved.id]);
  });

  it("counts a charge marked not spending nowhere, and lists it so it can be undone", () => {
    const back = tx(-100000, "2026-10-05", { markedNotSpending: true });
    const result = actuals([back, tx(-2000, "2026-10-06", { rule: to("gym") })]);
    expect(result).toMatchObject({ unsortedCents: 0, periodSpentCents: 2000, miscCount: 0 });
    expect(result.notSpending.map((t) => t.id)).toEqual([back.id]);
  });

  it("counts unsorted spending in the period, but not transfers or money in", () => {
    const result = actuals([
      tx(-1200, "2026-10-05"),
      tx(-300, "2026-10-06", { category: "TRANSFER_OUT" }),
      tx(400, "2026-10-07"),
      tx(-2000, "2026-10-08", { rule: to("gym") }),
    ]);
    expect(result.unsortedCents).toBe(1200);
    expect(actuals([], { dataKnown: false }).unsortedCents).toBeNull();
  });

  it("keeps an annual item's spending out of the Monthly total", () => {
    const result = actuals([tx(-50000, "2026-10-03", { rule: to("insurance") }), tx(-2000, "2026-10-04", { rule: to("gym") })]);
    expect(result.actualByItem.insurance).toBe(50000);
    expect(result.totalCents).toBe(2000);
  });

  it("puts the last day of the month in that month for an owner behind UTC", () => {
    // At 02:00 UTC on 1 November a Los Angeles owner's date is still 31 October.
    const result = actuals([tx(-2000, "2026-10-31", { rule: to("gym") })], { today: "2026-10-31" });
    expect(result.period).toEqual({ start: "2026-10-01", endExclusive: "2026-11-01" });
    expect(result.actualByItem.gym).toBe(2000);
  });

  it("piles unmatched spending since the start date by merchant, as amounts spent", () => {
    const result = actuals([
      tx(-1200, "2026-10-02", { sourceKey: "cafe", label: "Cafe" }),
      tx(-800, "2026-10-12", { sourceKey: "cafe", label: "Cafe" }),
      tx(-9000, "2026-09-12", { sourceKey: "cafe", label: "Cafe" }),
      tx(500, "2026-10-12", { sourceKey: "cafe", label: "Cafe" }),
    ]);
    expect(result.miscCount).toBe(2);
    expect(result.misc).toMatchObject([{ sourceKey: "cafe", count: 2, totalCents: 2000, latestDate: "2026-10-12" }]);
  });

  it("totals real spending by business, tax category and Schedule C line, out of budget included", () => {
    const transactions = [
      tx(-50000, "2026-10-03", { rule: to("insurance") }),
      tx(-4000, "2026-10-04", { rule: to("gym") }),
      tx(-700, "2026-10-05", { choice: out("studio", "health") }),
      tx(-300, "2026-10-06", { choice: out() }),
    ];
    const studio = actuals(transactions, { view: "annual", filter: { kind: "business", businessId: "studio" } });
    expect(studio.totalCents).toBe(50700);
    const personal = actuals(transactions, { filter: { kind: "personal" } });
    expect(personal.totalCents).toBe(4300);
    const all = actuals(transactions, { view: "annual" });
    expect(all.byCategory).toEqual([
      { key: null, totalCents: 50300 },
      { key: "health", totalCents: 700 },
    ]);
    expect(all.byLine).toEqual([
      { key: null, totalCents: 50300 },
      { key: "line-a", totalCents: 700 },
    ]);
  });
});

describe("standing", () => {
  it("says what is left, how far over, or that it is on the line", () => {
    expect(standing(5000, 3000)).toEqual({ kind: "left", cents: 2000 });
    expect(standing(5000, 6500)).toEqual({ kind: "over", cents: 1500 });
    expect(standing(5000, 5000)).toEqual({ kind: "even", cents: 0 });
  });
});
