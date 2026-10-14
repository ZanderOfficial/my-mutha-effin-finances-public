import { describe, expect, it } from "vitest";
import { plannedBudget, type PlannedFilter, type PlannedItem, type PlannedView } from "./planned-budget";

// Tiny synthetic items; they exist only in this file.
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

const LINES: Record<string, string> = { software: "line-a", phone: "line-b" };
const budget = (items: PlannedItem[], view: PlannedView = "monthly", filter: PlannedFilter = { kind: "all" }) =>
  plannedBudget({ items, view, filter, lineOf: (category) => (category ? (LINES[category] ?? null) : null) });

describe("plannedBudget", () => {
  it("shows nothing as unknown for an empty budget, and a real zero once anything is entered", () => {
    expect(budget([]).totalCents).toBeNull();
    expect(budget([item("rent", 150000, { frequency: "annual" })], "monthly").totalCents).toBe(0);
  });

  it("totals the monthly items in the Monthly view and only the annual items in the Annual view", () => {
    const items = [item("rent", 150000), item("insurance", 90000, { frequency: "annual" })];
    expect(budget(items, "monthly").totalCents).toBe(150000);
    const annual = budget(items, "annual");
    expect(annual.totalCents).toBe(90000);
    expect(annual.rows.map((r) => [r.item.id, r.viewAmountCents])).toEqual([["insurance", 90000]]);
  });

  it("makes an item with sub-items worth its active sub-items, never its own typed amount", () => {
    const items = [
      item("utilities", 99999),
      item("electric", 12000, { parentId: "utilities" }),
      item("water", 6000, { parentId: "utilities" }),
      item("old internet", 5000, { parentId: "utilities", status: "not_paying" }),
    ];
    const [utilities] = budget(items).rows;
    expect(utilities).toMatchObject({ amountCents: 18000, computed: true });
    expect(utilities.subItems.map((s) => s.counts)).toEqual([true, true, false]);
    expect(budget(items).totalCents).toBe(18000);
  });

  it("makes a parent whose sub-items are all greyed out a real $0.00", () => {
    const items = [item("gym", 4000), item("pool", 2000, { parentId: "gym", status: "not_paying" })];
    expect(budget(items).rows[0].amountCents).toBe(0);
    expect(budget(items).totalCents).toBe(0);
  });

  it("leaves a greyed-out parent and all its sub-items out of every total, but keeps the rows", () => {
    const items = [
      item("utilities", 0, { status: "not_paying", taxCategoryId: "phone" }),
      item("electric", 12000, { parentId: "utilities", taxCategoryId: "phone" }),
      item("rent", 150000),
    ];
    const result = budget(items);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ counts: false, amountCents: 12000 });
    expect(result.rows[0].subItems[0].counts).toBe(false);
    expect(result.totalCents).toBe(150000);
    expect(result.byCategory).toEqual([{ key: null, totalCents: 150000 }]);
  });

  it("counts a cost shared by several businesses in full in each business, and once in All", () => {
    const items = [
      item("hosting", 3000, { businessIds: ["studio", "shop"] }),
      item("domain", 1000, { businessIds: ["studio"] }),
      item("groceries", 50000),
    ];
    const studio = budget(items, "monthly", { kind: "business", businessId: "studio" });
    const shop = budget(items, "monthly", { kind: "business", businessId: "shop" });
    const all = budget(items);
    expect(studio.totalCents).toBe(4000);
    expect(shop.totalCents).toBe(3000);
    expect(all.totalCents).toBe(54000);
    expect(studio.sharedCount).toBe(1);
    expect(all.sharedCount).toBe(0);
    expect(budget(items, "monthly", { kind: "personal" }).rows.map((r) => r.item.id)).toEqual(["groceries"]);
  });

  it("groups by each sub-item's own tax category and by the Schedule C line it maps to", () => {
    const items = [
      item("office", 0, { taxCategoryId: "software" }),
      item("design app", 5000, { parentId: "office", taxCategoryId: "software" }),
      item("office phone", 3000, { parentId: "office", taxCategoryId: "phone" }),
      item("misc", 700),
    ];
    const result = budget(items);
    expect(result.byCategory).toEqual([
      { key: "software", totalCents: 5000 },
      { key: "phone", totalCents: 3000 },
      { key: null, totalCents: 700 },
    ]);
    expect(result.byLine).toEqual([
      { key: "line-a", totalCents: 5000 },
      { key: "line-b", totalCents: 3000 },
      { key: null, totalCents: 700 },
    ]);
    const sumOf = (groups: { totalCents: number }[]) => groups.reduce((a, g) => a + g.totalCents, 0);
    expect(sumOf(result.byCategory)).toBe(result.totalCents);
    expect(sumOf(result.byLine)).toBe(result.totalCents);
  });
});
