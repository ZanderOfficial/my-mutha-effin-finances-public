import { describe, expect, it } from "vitest";
import { budgetActuals, type BudgetTransaction, type Placement } from "./actuals";
import { isLarge, learnFromDecisions, median, type Decision } from "./learning";
import type { PlannedItem } from "./planned-budget";

// Tiny synthetic items and charges; they exist only in this file.
const FOOD: Placement = { kind: "planned_item", plannedItemId: "food" };
const HOME: Placement = { kind: "planned_item", plannedItemId: "home" };
const OUT: Placement = { kind: "out_of_budget", businessId: null, taxCategoryId: null };
const ONCE: Placement = { kind: "one_time", businessId: null, taxCategoryId: null, oneTimeKindId: null };

const decide = (placement: Placement, spentCents = 6000): Decision => ({ sourceKey: "mart", placement, spentCents });
const times = (count: number, placement: Placement) => Array.from({ length: count }, () => decide(placement));

describe("learnFromDecisions", () => {
  it("learns nothing from fewer than 3 decisions", () => {
    expect(learnFromDecisions(times(2, FOOD)).get("mart")?.placement).toBeNull();
    expect(learnFromDecisions(times(3, FOOD)).get("mart")?.placement).toEqual(FOOD);
  });

  it("learns at exactly 90% agreement, not at 89%", () => {
    expect(learnFromDecisions([...times(9, FOOD), decide(HOME)]).get("mart")?.placement).toEqual(FOOD);
    const eightyNine = [...times(89, FOOD), ...times(11, HOME)];
    expect(learnFromDecisions(eightyNine).get("mart")?.placement).toBeNull();
  });

  it("counts out of budget as one place, and keeps each merchant apart", () => {
    const learned = learnFromDecisions([...times(3, OUT), { sourceKey: "fuel", placement: HOME, spentCents: 4000 }]);
    expect(learned.get("mart")?.placement).toEqual(OUT);
    expect(learned.get("fuel")).toEqual({ placement: null, usualCents: 4000 });
  });
});

describe("learning one-time spending", () => {
  it("learns a merchant as one-time, a place of its own apart from out of budget", () => {
    expect(learnFromDecisions(times(3, ONCE)).get("mart")?.placement).toEqual(ONCE);
    expect(learnFromDecisions([...times(2, ONCE), decide(OUT)]).get("mart")?.placement).toBeNull();
  });
});

describe("median and isLarge", () => {
  it("takes the middle charge, or the rounded mean of the middle two", () => {
    expect(median([500, 100, 300])).toBe(300);
    expect(median([100, 200, 301, 400])).toBe(251);
    expect(median([])).toBe(0);
  });

  it("calls a charge large at twice the usual or more", () => {
    const learned = { placement: FOOD, usualCents: 6000 };
    expect(isLarge(11999, learned)).toBe(false);
    expect(isLarge(12000, learned)).toBe(true);
    expect(isLarge(50000, undefined)).toBe(false);
  });
});

describe("budgetActuals with learning", () => {
  const item = (id: string): PlannedItem => ({
    id,
    parentId: null,
    name: id,
    amountCents: 40000,
    frequency: "monthly",
    status: "active",
    notes: "",
    taxCategoryId: null,
    businessIds: [],
  });
  let seq = 0;
  const tx = (amountCents: number, over: Partial<BudgetTransaction> = {}): BudgetTransaction => ({
    id: `t${++seq}`,
    date: "2026-10-05",
    label: "Mart",
    name: "MART",
    sourceKey: "mart",
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
  const actuals = (transactions: BudgetTransaction[]) =>
    budgetActuals({
      items: [item("food"), item("home")],
      transactions,
      startDate: "2026-10-01",
      today: "2026-10-20",
      view: "monthly",
      filter: { kind: "all" },
      lineOf: () => null,
      dataKnown: true,
    });
  const decided = () => [tx(-6000, { choice: FOOD }), tx(-5000, { choice: FOOD }), tx(-7000, { choice: FOOD })];

  it("places a new charge where 3 decisions agree, marked auto, and leaves Misc empty", () => {
    const fresh = tx(-6500);
    const result = actuals([...decided(), fresh]);
    expect(result.actualByItem.food).toBe(24500);
    expect(result.matchedByItem.food.find((t) => t.id === fresh.id)?.auto).toEqual(FOOD);
    expect(result.miscCount).toBe(0);
  });

  it("leaves a large purchase from a learned merchant in Misc, with the merchant's usual", () => {
    const big = tx(-30000);
    const result = actuals([...decided(), big]);
    expect(result.actualByItem.food).toBe(18000);
    expect(result.misc[0].rows).toMatchObject([{ id: big.id, usualCents: 6000 }]);
  });

  it("lets the merchant's Always rule beat what was learned", () => {
    const ruled = tx(-6500, { rule: HOME });
    expect(actuals([...decided(), ruled]).actualByItem.home).toBe(6500);
  });

  it("takes a refund from a learned merchant off the same line", () => {
    expect(actuals([...decided(), tx(1000)]).actualByItem.food).toBe(17000);
  });

  it("learns nothing from a merchant with too few decisions", () => {
    const result = actuals([tx(-6000, { choice: FOOD }), tx(-6000)]);
    expect(result.miscCount).toBe(1);
  });
});
