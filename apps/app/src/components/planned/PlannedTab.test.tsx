import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { budgetActuals, type BudgetTransaction } from "@/lib/actuals";
import { incomeByMonth } from "@/lib/income";
import { plannedBudget, type PlannedItem } from "@/lib/planned-budget";
import { labelTotals, lineKeyFor, type TaxCategory } from "@/lib/tax-categories";
import type { PlannedData, PlannedTab as Tab } from "@/server/reports";
import { yearFlow } from "@/lib/year-flow";
import { CatchUpTab } from "./CatchUpTab";
import { PlannedTab } from "./PlannedTab";

// Tiny synthetic values; they exist only in this file.
const STUDIO = "00000000-0000-4000-8000-00000000000a";
const SHOP = "00000000-0000-4000-8000-00000000000b";
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
const items = [
  item("Rent", 150000),
  item("Utilities", 99999),
  item("Electric", 12000, { parentId: "Utilities" }),
  item("Old phone", 4000, { status: "not_paying" }),
  item("Hosting", 3000, { businessIds: [STUDIO, SHOP], taxCategoryId: "cat-1" }),
];
const categories: TaxCategory[] = [
  {
    id: "cat-1",
    name: "Software",
    mapping: { kind: "line", year: 2025, line: "18" },
    confirmed: false,
    line: { year: 2025, line: "18", heading: null, label: "Office expense (see instructions)" },
  },
];

let seq = 0;
const spend = (amountCents: number, over: Partial<BudgetTransaction> = {}): BudgetTransaction => ({
  id: `t${++seq}`,
  date: "2026-10-05",
  label: "Rent Co",
  name: "RENT CO",
  sourceKey: "rent co",
  amountCents,
  pending: false,
  category: "RENT_AND_UTILITIES",
  categoryDetail: null,
  countedAsIncome: false,
  ownTransfer: false,
  choice: null,
  rule: null,
  ...over,
});
const transactions = [
  spend(-160000, { rule: { kind: "planned_item", plannedItemId: "Rent" } }),
  spend(-2500, { label: "Corner Cafe", name: "CORNER CAFE 12", sourceKey: "corner cafe" }),
  spend(-900, { choice: { kind: "out_of_budget", businessId: null, taxCategoryId: null }, label: "Gift Shop", sourceKey: "gift shop" }),
];

function dataFor(tab: Tab, overrides: Partial<PlannedData> = {}): PlannedData {
  const filter = tab.kind === "business" ? ({ kind: "business", businessId: tab.businessId } as const) : ({ kind: "all" } as const);
  const budget = plannedBudget({ items, view: "monthly", filter, lineOf: lineKeyFor(categories) });
  const actuals = budgetActuals({
    items,
    transactions,
    startDate: "2026-10-01",
    today: "2026-10-20",
    view: "monthly",
    filter,
    lineOf: lineKeyFor(categories),
    dataKnown: true,
  });
  return {
    tab,
    period: "monthly",
    by: "line",
    budget,
    allItems: items,
    actuals,
    actualTotals: labelTotals(actuals.byLine, "line", categories),
    startDate: "2026-10-01",
    spendingRules: [{ id: "r1", sourceKey: "rent co", label: "Rent Co", target: "Rent", spendingCount: 1 }],
    monthlyCents: budget.totalCents,
    annualCents: null,
    totals: labelTotals(budget.byLine, "line", categories),
    businesses: [
      { id: STUDIO, name: "Studio" },
      { id: SHOP, name: "Shop" },
    ],
    categories,
    oneTimeKinds: [{ id: "k-meals", name: "Eating out" }],
    scheduleC: { year: 2025, sourceUrl: "https://www.irs.gov/pub/irs-pdf/f1040sc.pdf", checkedOn: "2026-10-09", lines: [] },
    businessIncome: null,
    madeCents: null,
    standing: null,
    today: "2026-10-10",
    canEdit: true,
    ...overrides,
  };
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** The markup of one item's table row: the <tr> holding that row's <form id="item-…">. */
function rowOf(html: string, itemId: string): string {
  const at = html.indexOf(`<form id="item-${itemId}"`);
  if (at < 0) throw new Error(`No row for ${itemId}`);
  return html.slice(html.lastIndexOf("<tr", at), html.indexOf("</tr>", at));
}

/** The names of the fields a row posts: every input and select tied to its form. */
function postedNames(html: string, itemId: string): string[] {
  const field = new RegExp(`<(?:input|select) [^>]*form="item-${itemId}"[^>]* name="([A-Za-z]+)"`, "g");
  return [...html.matchAll(field)].map((match) => match[1]);
}

const planned = () => renderToStaticMarkup(<PlannedTab data={dataFor({ kind: "planned", personalOnly: false })} mode="ledger" />);
const expenses = (over: Partial<PlannedData> = {}) =>
  renderToStaticMarkup(<PlannedTab data={dataFor({ kind: "planned", personalOnly: false }, over)} mode="expenses" />);

describe("PlannedTab", () => {
  it("puts income made against the planned total at the top, and leaves it out while income is unknown", () => {
    const made = (madeCents: number | null) => text(renderToStaticMarkup(<PlannedTab data={dataFor({ kind: "planned", personalOnly: false }, { madeCents })} mode="ledger" />));
    expect(made(1)).toMatch(/Made this month \$0\.01 Made against planned ! \$[\d,.]+ short/);
    expect(made(null)).toContain("Made this month —");
    expect(made(null)).not.toContain("Made against planned");
  });

  it("shows each row, a parent's amount from its sub-items, and why a row is greyed out", () => {
    const html = planned();
    expect(text(rowOf(html, "Utilities"))).toContain("Σ $120.00 from 1 sub-item");
    expect(rowOf(html, "Utilities")).toContain('title="The total of the 1 sub-item being paid"');
    expect(html).toMatch(/aria-expanded="true" aria-controls="item-row-Electric" aria-label="Sub-items of Utilities"/);
    expect(text(rowOf(html, "Old phone"))).toContain("Counts in no total");
    expect(text(rowOf(html, "Old phone"))).toContain("○ Not paying");
    expect(rowOf(html, "Old phone")).toContain('title="Not currently paying, so it counts in no total."');
    expect(text(html)).toContain("Monthly total $1,650.00");
  });

  it("keeps every field of a row in its form, and leaves out only what the server refuses", () => {
    const html = planned();
    // A plain row posts all of it, because updateItem replaces the For tags and the notes.
    expect(postedNames(html, "Rent")).toEqual(["name", "amount", "frequency", "businessId", "businessId", "taxCategoryId", "notes", "itemId"]);
    // A parent's amount is its sub-items' total; a sub-item takes its parent's frequency and For tags.
    expect(postedNames(html, "Utilities")).toEqual(["name", "frequency", "businessId", "businessId", "taxCategoryId", "notes", "itemId"]);
    expect(postedNames(html, "Electric")).toEqual(["name", "amount", "taxCategoryId", "notes", "itemId"]);
  });

  it("names Schedule C totals in the form's words, and asks for a proposed line to be confirmed", () => {
    const t = text(planned());
    expect(t).toContain("Line 18 · Office expense (see instructions) $30.00");
    expect(t).toContain("Not on a Schedule C line yet $1,620.00");
    expect(t).toContain("▲ Proposed");
    expect(t).toContain("Confirm the line for Software");
    expect(t).toContain("1 still show the app");
    expect(t).toContain("it does not say what is deductible");
  });

  it("on a business tab, counts a shared cost in full and says so, and starts new items ticked for it", () => {
    const html = renderToStaticMarkup(<PlannedTab data={dataFor({ kind: "business", businessId: STUDIO })} mode="ledger" />);
    const t = text(html);
    expect(t).toContain("Studio, planned each month");
    expect(t).toContain("1 cost here is shared with other businesses and counted in full");
    expect(text(rowOf(html, "Hosting"))).toContain("Shared ×2");
    expect(html).toMatch(new RegExp(`id="new-for-${STUDIO}"[^>]*checked`));
    expect(t).not.toContain("Tax categories");
  });

  it("offers the spreadsheet categories only while there are none", () => {
    const t = text(renderToStaticMarkup(<PlannedTab data={dataFor({ kind: "planned", personalOnly: false }, { categories: [] })} mode="ledger" />));
    expect(t).toContain("Add my 45 categories");
  });

  it("prompts to sort Misc by merchant, with the three choices and Always ticked", () => {
    const html = expenses();
    const t = text(html);
    expect(t).toContain("To sort ! 1 1 transaction to sort.");
    const at = html.indexOf('<form id="misc-corner-cafe"');
    expect(text(html.slice(html.lastIndexOf("<tr", at), at))).toMatch(/Corner Cafe .*\$25\.00 1 Oct 5/);
    expect(t).toContain("Always sort Corner Cafe this way");
    expect(html).toMatch(/<input type="checkbox" form="misc-corner-cafe"[^>]*name="always" checked="" value="1"/);
    // The three choices, posted as sortMerchantAction's "do" by the row's one button.
    expect(html).toContain('<option value="item:Rent">Rent</option>');
    expect(html).toContain('<option value="out">Out of budget</option>');
    expect(html).toContain('<option value="new">New line item…</option>');
    expect(html).toMatch(/<button type="submit" form="misc-corner-cafe"[^>]*name="do">Sort/);
    expect(html).toContain('name="newName" value="Corner Cafe"');
    // Each charge has its own place, folded under the merchant until opened; it goes with the merchant by default.
    expect(html).toMatch(/<select form="misc-corner-cafe" name="each:[^"]+"[^>]*aria-label="Oct 5, 2026, CORNER CAFE 12: sort to"/);
    expect(html).toContain('<option value="same" selected="">Same as above</option>');
    expect(t).toContain("Sort each charge from Corner Cafe");
    expect(html).toContain('name="newAmount" value="25"');
  });

  it("shows planned against spent on each row, with a word for over or left", () => {
    const html = planned();
    expect(rowOf(html, "Rent")).toContain('name="amount" value="$1,500.00"');
    expect(text(rowOf(html, "Rent"))).toContain("$1,600.00");
    expect(text(rowOf(html, "Rent"))).toContain("! Over by $100.00");
    expect(rowOf(html, "Hosting")).toContain('name="amount" value="$30.00"');
    expect(text(rowOf(html, "Hosting"))).toContain("$0.00 ✓ $30.00 left");
    expect(text(rowOf(html, "Rent"))).toContain("1 matched transaction");
  });

  it("compares Standing with spending on paying line items only, and says so where Spent shows more", () => {
    const html = renderToStaticMarkup(<PlannedTab data={dataFor({ kind: "planned", personalOnly: false })} mode="ledger" />);
    const t = text(html);
    // Planned $1,650.00; $1,609.00 sorted includes $9.00 out of budget, which Standing leaves out.
    // Spent also counts the $25.00 still in Misc, so it is every real purchase this month.
    expect(t).toContain("Spent this month $1,634.00 includes $25.00 not sorted yet");
    expect(t).toContain("Standing ✓ $50.00 left against $1,600.00 spent on paying line items");
    expect(t).toContain("Monthly total $1,650.00 $1,609.00 ✓ $50.00 left");
    expect(t).toContain("vs $1,600.00 on paying items");
  });

  it("shows a business tab that business's income by month, with unknown months as dashes", () => {
    const income = incomeByMonth({
      year: 2026,
      today: "2026-10-20",
      historyStart: "2026-09-10",
      deposits: [
        { id: "d1", date: "2026-09-15", label: "Client A", amountCents: 120000, pending: false, status: "income", businessId: STUDIO },
        { id: "d2", date: "2026-10-02", label: "Client B", amountCents: 5000, pending: false, status: "income", businessId: SHOP },
      ],
      filter: { kind: "business", businessId: STUDIO },
    });
    const t = text(renderToStaticMarkup(<PlannedTab data={dataFor({ kind: "business", businessId: STUDIO }, { businessIncome: income })} mode="ledger" />));
    expect(t).toContain("Studio income, 2026");
    expect(t).toContain("August — Before history —");
    expect(t).toContain("September ◐ Partial $1,200.00");
    expect(t).toContain("October ◐ Partial $0.00");
    expect(t).toContain("Year total $1,200.00");
    expect(text(renderToStaticMarkup(<PlannedTab data={dataFor({ kind: "planned", personalOnly: false })} mode="ledger" />))).not.toContain("income, 2026");
  });

  it("lists out-of-budget spending, the spending rules and when checking started", () => {
    const t = text(planned());
    expect(t).toMatch(/Out of budget No planned amount \$9\.00 .*this month/);
    expect(t).toContain("Rent Co Rent 1 Undo the rule for Rent Co");
    expect(t).toContain("Spending is checked from Oct 1, 2026 on.");
  });

  it("names each row by its item for screen readers, and keeps every Spent figure on one edge", () => {
    const html = planned();
    expect(rowOf(html, "Rent")).toContain('<th scope="row" aria-label="Rent"');
    expect(rowOf(html, "Electric")).toContain('<th scope="row" aria-label="Electric"');
    // A row with no matched charges keeps the space the count takes, so its figure lines up with the rest.
    expect(rowOf(html, "Hosting")).toMatch(/\$0\.00<\/span><\/span><span aria-hidden="true" class="inline-block [^"]*w-12"><\/span>/);
  });

  it("puts Always beside the Sort button in the row's last cell, so a phone sees both", () => {
    const html = expenses();
    expect(html).toMatch(/<form id="misc-corner-cafe"><\/form><div[^>]*><label[^>]*><input type="checkbox" form="misc-corner-cafe"[^>]*name="always"[^]*?name="do">Sort/);
  });

  it("shows no To sort at all when nothing waited to be sorted", () => {
    const data = dataFor({ kind: "planned", personalOnly: false });
    const html = renderToStaticMarkup(<PlannedTab data={{ ...data, actuals: { ...data.actuals, misc: [], miscCount: 0 } }} mode="expenses" />);
    expect(html).not.toContain('id="misc"');
    expect(html).not.toContain('id="misc-heading"');
  });

  it("keeps the Misc prompt on Expenses and points to it from a business tab", () => {
    const t = text(renderToStaticMarkup(<PlannedTab data={dataFor({ kind: "business", businessId: STUDIO })} mode="ledger" />));
    expect(t).not.toContain("Always sort");
    expect(t).toContain("! 1 transaction in Misc for all businesses, sorted on Expenses");
  });

  it("edits the budget on the Ledger: no Misc pile there, and businesses, rules and tax categories beside the table", () => {
    const t = text(planned());
    expect(t).not.toContain("Always sort");
    expect(t).toContain("Ledger: planned items against what was spent");
    expect(t).toMatch(/Businesses 2/);
    expect(t).toContain("Spending rules");
  });

  it("lists every expense on Expenses with where it is matched, and a Match to on each row", () => {
    const html = expenses();
    const t = text(html);
    expect(t).toContain("Every expense this month");
    expect(t).toMatch(/Corner Cafe \$25\.00 Misc · not sorted/);
    expect(t).toMatch(/Rent Co \$1,600\.00 Rent · rule/);
    expect(html).toMatch(/aria-label="Move Corner Cafe on Oct 5, 2026 to"/);
    expect(text(planned())).not.toContain("Every expense");
  });

  it("opens Expenses on this month's headline: income minus what the month needs minus extras", () => {
    const standing = {
      incomeCents: 130000,
      monthlyCents: 140000,
      setAsideCents: 10500,
      needCents: 150500,
      extrasCents: 2500,
      standingCents: -23000,
      spentCents: 163400,
      unsortedCents: 2500,
    };
    const t = text(expenses({ standing }));
    expect(t).toContain("After everything this month −$230");
    expect(t).toContain("$230 short with 21 days left.");
    expect(t).toContain("Made this month $1,300.00 The month needs $1,505.00 Spent this month $1,634.00 includes $25.00 not sorted yet");
    expect(t).toContain("($1,400.00 of monthly items and $105.00 a month for annual ones)");
    expect(t).not.toContain("Totals by");
  });
});

describe("CatchUpTab", () => {
  it("shows each month's made, spent and kept, flags an overspent month, and offers every sorting tool", () => {
    const planned = dataFor({ kind: "planned", personalOnly: false });
    const income = incomeByMonth({ year: 2026, today: "2026-10-20", historyStart: "2026-09-01", deposits: [], filter: { kind: "all" } });
    const html = renderToStaticMarkup(<CatchUpTab data={{ planned, flow: yearFlow(income, planned.actuals.spending), unsorted: [] }} />);
    const t = text(html);
    expect(t).toContain("Catch up on 2026");
    expect(t).toMatch(/October so far \$0\.00 \$1,634\.00 −\$1,634\.00 ! Spent more than came in/);
    expect(t).toMatch(/August — — — —/);
    expect(t).toContain("Always sort Corner Cafe this way");
    expect(t).toContain("Every expense this year so far");
  });
});
