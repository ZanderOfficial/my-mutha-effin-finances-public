import { describe, expect, it } from "vitest";
import {
  changedFields,
  formSnapshot,
  itemPosts,
  madeVerdict,
  monthStateLabel,
  planStanding,
  planStandingOf,
  planVerdict,
  savedAfter,
  savedSelectValue,
  shortLineName,
  sortedNote,
  sortRequest,
  taxCategoryState,
  taxCategoryViews,
} from "./budget-table";
import type { TaxCategory } from "./tax-categories";

describe("itemPosts: which fields a planned item's row sends to updateItem", () => {
  it("a plain top-level item sends its amount, frequency and For tags", () => {
    expect(itemPosts({ parentId: null }, 0)).toEqual({ amount: true, frequency: true, forTags: true });
  });

  it("an item with sub-items sends no amount, because its amount is their total", () => {
    expect(itemPosts({ parentId: null }, 2)).toEqual({ amount: false, frequency: true, forTags: true });
  });

  it("a sub-item sends no frequency and no For tags, because it takes its parent's", () => {
    expect(itemPosts({ parentId: "parent" }, 0)).toEqual({ amount: true, frequency: false, forTags: false });
  });
});

describe("formSnapshot", () => {
  it("is the same for the same fields and values", () => {
    const a = formSnapshot([["name", "Rent"], ["amount", "1850"]]);
    expect(formSnapshot([["name", "Rent"], ["amount", "1850"]])).toBe(a);
  });

  it("changes when any value changes, or a repeated field gains a value", () => {
    const base = formSnapshot([["name", "Rent"], ["businessId", "a"]]);
    expect(formSnapshot([["name", "Rent "], ["businessId", "a"]])).not.toBe(base);
    expect(formSnapshot([["name", "Rent"], ["businessId", "a"], ["businessId", "b"]])).not.toBe(base);
  });
});

describe("sortRequest: the Misc inbox's one 'Sort to' choice as the fields sortMerchantAction reads", () => {
  it("a line item becomes do=item with its id as itemTarget", () => {
    expect(sortRequest("item:abc")).toEqual({ do: "item", itemTarget: "abc" });
  });

  it("out of budget and a new line item carry no target", () => {
    expect(sortRequest("out")).toEqual({ do: "out", itemTarget: "" });
    expect(sortRequest("new")).toEqual({ do: "new", itemTarget: "" });
  });

  it("nothing chosen sends no choice, so the server asks for one", () => {
    expect(sortRequest("")).toEqual({ do: "", itemTarget: "" });
    expect(sortRequest("item:")).toEqual({ do: "", itemTarget: "" });
  });
});

describe("planStanding: planned against actual in words, never colour alone", () => {
  it("says how much is left, with a tick", () => {
    expect(planStanding({ kind: "left", cents: 750 })).toEqual({ glyph: "✓", words: "$7.50 left", tone: "income" });
  });

  it("says how much over, with a bang", () => {
    expect(planStanding({ kind: "over", cents: 4820 })).toEqual({ glyph: "!", words: "Over by $48.20", tone: "spending" });
  });

  it("says when it is exactly on the line, quietly", () => {
    expect(planStanding({ kind: "even", cents: 0 })).toEqual({ glyph: "=", words: "On the line", tone: "muted" });
  });

  it("works it out from planned and spent, and says nothing while either is unknown", () => {
    expect(planStandingOf(1000, 250)).toEqual({ glyph: "✓", words: "$7.50 left", tone: "income" });
    expect(planStandingOf(1000, 1000)).toEqual({ glyph: "=", words: "On the line", tone: "muted" });
    expect(planStandingOf(null, 250)).toBeNull();
    expect(planStandingOf(1000, null)).toBeNull();
  });
});

describe("monthStateLabel", () => {
  it("names each month state with a glyph", () => {
    expect(monthStateLabel("complete")).toEqual({ glyph: "✓", words: "Complete" });
    expect(monthStateLabel("partial")).toEqual({ glyph: "◐", words: "Partial" });
    expect(monthStateLabel("future")).toEqual({ glyph: "—", words: "Not yet" });
    expect(monthStateLabel("before_history")).toEqual({ glyph: "—", words: "Before history" });
  });
});

const category = (id: string, mapping: TaxCategory["mapping"], confirmed: boolean): TaxCategory => ({
  id,
  name: id,
  mapping,
  confirmed,
  line: mapping.kind === "line" ? { year: mapping.year, line: mapping.line, heading: null, label: "Supplies" } : null,
});
const line = { kind: "line", year: 2025, line: "22" } as const;

describe("taxCategoryState", () => {
  it("an unconfirmed mapping is proposed; a saved line is confirmed", () => {
    expect(taxCategoryState(category("a", line, false))).toBe("proposed");
    expect(taxCategoryState(category("b", line, true))).toBe("confirmed");
  });

  it("personal is personal once confirmed, and nothing chosen is none", () => {
    expect(taxCategoryState(category("c", { kind: "personal" }, true))).toBe("personal");
    expect(taxCategoryState(category("d", { kind: "personal" }, false))).toBe("proposed");
    expect(taxCategoryState(category("e", { kind: "unmapped" }, false))).toBe("none");
  });
});

describe("taxCategoryViews: the filters over the tax category list", () => {
  const list = [
    category("a", line, false),
    category("b", line, true),
    category("c", { kind: "personal" }, true),
    category("d", { kind: "unmapped" }, false),
  ];

  it("splits the list by what still needs the owner, without changing it", () => {
    const views = taxCategoryViews(list);
    expect(views.map((view) => [view.id, view.categories.map((c) => c.id)])).toEqual([
      ["all", ["a", "b", "c", "d"]],
      ["confirm", ["a"]],
      ["personal", ["c"]],
      ["unmapped", ["d"]],
    ]);
  });
});

describe("shortLineName", () => {
  it("keeps the line number and the label without its parenthetical", () => {
    expect(shortLineName({ year: 2025, line: "18", heading: null, label: "Office expense (see instructions)" })).toBe(
      "18 · Office expense",
    );
  });

  it("shortens a long heading and label to fit a table cell", () => {
    const name = shortLineName({
      year: 2025,
      line: "16a",
      heading: "Interest (see instructions):",
      label: "Mortgage (paid to banks, etc.)",
    });
    expect(name).toBe("16a · Interest: Mortgage");
  });

  it("cuts anything longer than a cell with an ellipsis", () => {
    const name = shortLineName({ year: 2025, line: "27b", heading: null, label: "Energy efficient commercial buildings deduction" });
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name.endsWith("…")).toBe(true);
  });
});

describe("sortedNote: the one line a sorted inbox row leaves behind", () => {
  it("says a rule now covers the source's later rows when Always was ticked", () => {
    expect(sortedNote({ source: "Parking Co", outcome: "sorted to Out of budget", always: true, unit: "charge" })).toBe(
      "Parking Co sorted to Out of budget, and every later charge from it too.",
    );
  });

  it("says only the ticked rows were decided when Always was not", () => {
    expect(sortedNote({ source: "Mobile deposit", outcome: "marked income", always: false, unit: "deposit" })).toBe(
      "The ticked deposits from Mobile deposit marked income. The next one will ask again.",
    );
  });
});

describe("changedFields: the cells a refused save marks", () => {
  it("names every cell whose value differs from its saved value, once each", () => {
    const fields = [
      { name: "name", value: "Rent", saved: "Rent" },
      { name: "amount", value: "12x", saved: "$1,500.00" },
      { name: "notes", value: "Due the 2nd", saved: "Due the 1st" },
      { name: "taxCategoryId", value: "", saved: "" },
    ];
    expect(changedFields(fields)).toEqual(["amount", "notes"]);
  });

  it("marks nothing when nothing was changed", () => {
    expect(changedFields([{ name: "name", value: "Rent", saved: "Rent" }])).toEqual([]);
  });
});

describe("savedSelectValue: a select counts as changed only until it is saved", () => {
  const options = [
    { value: "", defaultSelected: false },
    { value: "cat-a", defaultSelected: true },
    { value: "cat-b", defaultSelected: false },
  ];

  it("reads the option rendered selected before any save", () => {
    expect(savedSelectValue("taxCategoryId", options, {})).toBe("cat-a");
    expect(savedSelectValue("taxCategoryId", options.map((o) => ({ ...o, defaultSelected: false })), {})).toBe("");
  });

  it("reads the value last saved once a post is saved, and ignores a refused one", () => {
    const posted: [string, string][] = [["taxCategoryId", "cat-b"], ["name", "Gym"]];
    const saved = savedAfter({}, posted, true);
    expect(savedSelectValue("taxCategoryId", options, saved)).toBe("cat-b");
    expect(changedFields([{ name: "taxCategoryId", value: "cat-b", saved: savedSelectValue("taxCategoryId", options, saved) }])).toEqual([]);
    const refused = savedAfter(saved, [["taxCategoryId", ""]], false);
    expect(savedSelectValue("taxCategoryId", options, refused)).toBe("cat-b");
  });
});

describe("planVerdict: the plan stands against spending on paying line items", () => {
  it("compares with plannedSpentCents and names it only when Spent shows more", () => {
    expect(planVerdict(10000, { totalCents: 9000, plannedSpentCents: 6000 })).toEqual({
      verdict: { glyph: "✓", words: "$40.00 left", tone: "income" },
      comparedCents: 6000,
    });
    expect(planVerdict(10000, { totalCents: 6000, plannedSpentCents: 6000 }).comparedCents).toBeNull();
  });

  it("has no verdict while either figure is unknown", () => {
    expect(planVerdict(null, { totalCents: 100, plannedSpentCents: 100 })).toEqual({ verdict: null, comparedCents: null });
    expect(planVerdict(100, { totalCents: null, plannedSpentCents: null })).toEqual({ verdict: null, comparedCents: null });
  });
});

describe("madeVerdict: income made against the planned total", () => {
  it("says ahead, covered exactly or short, and nothing while either side is unknown", () => {
    expect(madeVerdict(150000, 160000, "monthly")).toEqual({ glyph: "✓", words: "$100.00 ahead", tone: "income" });
    expect(madeVerdict(150000, 150000, "monthly")).toEqual({ glyph: "=", words: "Covered exactly", tone: "muted" });
    expect(madeVerdict(150000, 130000, "monthly")).toEqual({ glyph: "!", words: "$200.00 short", tone: "spending" });
    expect(madeVerdict(150000, 130000, "annual")?.words).toBe("$200.00 to go");
    expect(madeVerdict(null, 130000, "monthly")).toBeNull();
    expect(madeVerdict(150000, null, "monthly")).toBeNull();
  });
});
