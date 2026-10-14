import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { incomeByMonth, type IncomeDeposit } from "@/lib/income";
import { groupBySource } from "@/lib/sorting";
import { yearFlow } from "@/lib/year-flow";
import type { IncomeData } from "@/server/reports";
import { Businesses } from "./Businesses";
import { IncomeTab } from "./IncomeTab";

// Tiny synthetic values; they exist only in this file.
const deposit = (id: string, date: string, amountCents: number, status: IncomeDeposit["status"] = "income"): IncomeDeposit => ({
  id,
  date,
  label: `Client ${id}`,
  amountCents,
  pending: false,
  status,
  businessId: status === "income" && id === "d2" ? "b1" : null,
});

const deposits = [
  deposit("d1", "2026-01-05", 100000),
  deposit("d2", "2026-02-05", 300000),
  deposit("d3", "2026-03-05", 50000),
  deposit("d4", "2026-04-02", 20000),
  deposit("d5", "2026-04-03", 7000, "unsorted"),
];

const income = incomeByMonth({ year: 2026, today: "2026-04-10", historyStart: "2025-12-01", deposits, filter: { kind: "all" } });
const spending = [
  { date: "2026-01-20", amountCents: -60000 },
  { date: "2026-02-20", amountCents: -350000 },
  { date: "2026-04-05", amountCents: -10000 },
];

const data: IncomeData = {
  year: 2026,
  years: [2025, 2026],
  income,
  flow: yearFlow(income, spending),
  unsorted: groupBySource([
    { id: "d5", date: "2026-04-03", name: "MOBILE DEPOSIT 5", label: "MOBILE DEPOSIT 5", amountCents: 7000, pending: false, sourceKey: "mobile deposit" },
  ]),
  rules: [{ id: "r1", sourceKey: "client", label: "Client d2", kind: "income", businessName: "Studio", depositCount: 1 }],
  handSorted: [],
  businesses: [{ id: "b1", name: "Studio" }],
  canEdit: true,
};

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("IncomeTab", () => {
  const html = renderToStaticMarkup(<IncomeTab data={data} />);
  const t = text(html);

  it("shows the year's spending against its income and what is left over, under the income", () => {
    // $4,700 made, $4,200 spent: $500 left, and February spent past its income.
    expect(t.indexOf("Income in 2026")).toBeLessThan(t.indexOf("Spent in 2026"));
    expect(t).toMatch(/Spent in 2026 \$4,200/);
    expect(t).toMatch(/Left over \$500/);
    expect(t).toContain("1 month spent more than came in.");
  });

  it("calls a year that spent past its income what it is, in red", () => {
    const over = renderToStaticMarkup(<IncomeTab data={{ ...data, flow: yearFlow(income, [{ date: "2026-01-20", amountCents: -500000 }]) }} />);
    expect(text(over)).toMatch(/Spent past income \$300/);
    expect(over).toMatch(/glow-spending[^>]*><span[^>]*>\$300/);
  });

  it("puts the unsorted sources right under the hero, ahead of the months, each with Income, Not income, For and Always", () => {
    // The approved direction (issue #36) moved the hero above "To sort"; the inbox still comes before the year's figures.
    expect(t.indexOf("Income in 2026")).toBeLessThan(t.indexOf("To sort"));
    expect(t.indexOf("To sort")).toBeLessThan(t.indexOf("Deposits by month"));
    expect(t).toContain("1 deposit to sort.");
    expect(t).toContain("Always decide MOBILE DEPOSIT 5 this way");
    expect(html).toMatch(/<input type="checkbox" form="unsorted-mobile-deposit"[^>]*name="always" checked="" value="1"/);
    expect(html).toMatch(/<button type="submit" form="unsorted-mobile-deposit" value="income"[^>]*name="kind">Income</);
    expect(html).toMatch(/<button type="submit" form="unsorted-mobile-deposit" value="not_income"[^>]*name="kind">Not income</);
    expect(html).toContain('<option value="b1">Studio</option>');
  });

  it("draws a bar for each known month and marks the high and low", () => {
    expect(html.match(/<rect x=/g)).toHaveLength(4); // Jan to Mar, and April striped as partial
    expect(t).toContain("High $3k");
    expect(t).toContain("Low $500");
    expect(t).toContain("April is partial.");
  });

  it("lists each month's deposits with its business, the totals and the year total", () => {
    expect(t).toMatch(/Income deposits in February Feb 5 Client d2 Studio \$3,000\.00/);
    // Each counted deposit can be marked Not income on its own, for money that only came back.
    expect(html).toContain('<input type="hidden" name="transactionId" value="d2"/><input type="hidden" name="kind" value="not_income"/>');
    expect(t).toContain("Not income : Client d2, Feb 5");
    expect(t).toMatch(/April \$200\.00 ◐ Partial 1 ! 1 to sort \$200\.00/);
    expect(t).toMatch(/Year total .*\$4,700\.00/);
    expect(t).toContain("! 1 to sort");
  });

  it("marks the high and low months in the table on the same months as the chart", () => {
    expect(t).toMatch(/February \$3,000\.00 ✓ Complete ▲ high/);
    expect(t).toMatch(/March \$500\.00 ✓ Complete ▼ low/);
  });

  it("offers the synced years and an undo for each rule", () => {
    expect(html).toContain('href="/budget?view=income&amp;year=2025"');
    expect(t).toContain("Undo the rule for Client d2");
  });
});

describe("Businesses", () => {
  it("says the table is empty, and still offers a new business", () => {
    const t = text(renderToStaticMarkup(<Businesses businesses={[]} />));
    expect(t).toContain("Nothing here yet.");
    expect(t).toContain("New business");
  });
});
