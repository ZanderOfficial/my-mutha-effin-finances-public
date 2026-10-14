import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => undefined, usePathname: () => "/" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { Dial } from "@/components/Dial";
import { Money } from "@/components/Money";
import BudgetPage from "./budget/page";
import NetWorthPage from "./net-worth/page";
import OverviewPage from "./overview/page";
import TransactionsPage from "./transactions/page";

/**
 * With no auth configuration and no database (this test environment), every
 * screen must render the blank state: dashes for unknown, no dollar figure at
 * all, "Nothing here yet" text, no invented numbers.
 */
beforeAll(() => {
  delete process.env.NEON_AUTH_BASE_URL;
  delete process.env.NEON_AUTH_COOKIE_SECRET;
  delete process.env.DATABASE_URL;
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("blank screens", () => {
  it("Overview shows dashes and no dollar figure", async () => {
    const html = renderToStaticMarkup(await OverviewPage());
    const t = text(html);
    expect(t).toContain("—");
    expect(t).toContain("Nothing here yet");
    expect(t).toContain("Link an institution");
    expect(t).not.toMatch(/\$\d/);
    expect(html).not.toContain("<text"); // the dial draws no number
  });

  it("Budget opens on Expenses with a dash for this month, never $0.00", async () => {
    const html = renderToStaticMarkup(await BudgetPage({ searchParams: Promise.resolve({}) }));
    const t = text(html);
    expect(t).toContain("Income Expenses Ledger");
    expect(t).toContain("After everything this month —");
    expect(t).not.toMatch(/\$\d/);
    expect(t).not.toContain("Always sort"); // no sorting without an owner
  });

  it("Budget's Income tab shows dashes and empty axes, never invented bars", async () => {
    const html = renderToStaticMarkup(
      await BudgetPage({ searchParams: Promise.resolve({ view: "income", year: "1999" }) }),
    );
    const t = text(html);
    expect(t).toContain("Deposits by month");
    expect(t).toContain("—");
    expect(t).toContain("No income history for");
    expect(t).not.toMatch(/\$\d/);
    expect(html).not.toMatch(/<rect x=/); // no bars
    expect(html).not.toContain("<path"); // no trend line
    expect(html).not.toContain('id="unsorted"'); // no "To sort" inbox without an owner
    expect(t).not.toContain("New business");
  });

  it("Budget's Planned tab shows a dash and no rows, and offers no editing without an owner", async () => {
    for (const query of [{ view: "planned" }, { view: "planned", period: "annual", by: "line" }]) {
      const t = text(renderToStaticMarkup(await BudgetPage({ searchParams: Promise.resolve(query) })));
      expect(t).toContain("Nothing here yet");
      expect(t).toContain("—");
      expect(t).not.toMatch(/\$\d/);
      expect(t).not.toContain("New item");
      expect(t).not.toContain("Tax categories");
    }
  });

  it("Transactions says nothing is here and offers linking", async () => {
    const t = text(
      renderToStaticMarkup(await TransactionsPage({ searchParams: Promise.resolve({}) })),
    );
    expect(t).toContain("Nothing here yet");
    expect(t).toContain("Link an institution");
    expect(t).not.toMatch(/\$\d/);
  });

  it("Net worth shows a dash in every view", async () => {
    for (const view of [undefined, "investments", "debts"]) {
      const t = text(
        renderToStaticMarkup(
          await NetWorthPage({ searchParams: Promise.resolve({ view }) }),
        ),
      );
      expect(t).toContain("—");
      expect(t).not.toMatch(/\$\d/);
    }
  });

  it("junk query strings fall back to the plain view", async () => {
    const t = text(
      renderToStaticMarkup(
        await TransactionsPage({
          searchParams: Promise.resolve({ flow: "nope", page: "-3", q: ["a", "b"] }),
        }),
      ),
    );
    expect(t).toContain("Nothing here yet");
  });
});

describe("components", () => {
  it("Money renders null as a dash and a real zero as $0.00", () => {
    expect(text(renderToStaticMarkup(<Money cents={null} />))).toContain("—");
    expect(text(renderToStaticMarkup(<Money cents={0} />))).toContain("$0.00");
  });

  it("Money keeps the full value for screen readers when compact", () => {
    const html = renderToStaticMarkup(<Money cents={1_234_000_000} compact />);
    expect(html).toContain("$12.3M");
    expect(html).toContain('class="sr-only">$12,340,000.00');
  });

  it("Dial has an empty outline and no text when unknown", () => {
    const html = renderToStaticMarkup(<Dial incomeCents={null} spendingCents={null} />);
    expect(html).not.toContain("<text");
    expect(html).toContain("No income or spending data yet.");
  });

  it("Dial centre carries only the signed gap", () => {
    const over = renderToStaticMarkup(<Dial incomeCents={100000} spendingCents={141200} />);
    expect(over).toMatch(/<text[^>]*>−\$412\.00<\/text>/);
    const kept = renderToStaticMarkup(<Dial incomeCents={100000} spendingCents={40000} />);
    expect(kept).toMatch(/<text[^>]*>\+\$600\.00<\/text>/);
  });
});
