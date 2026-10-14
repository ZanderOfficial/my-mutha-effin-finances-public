// Reads the signed-in owner per request; must never be prerendered.
export const dynamic = "force-dynamic";

import { ViewTabs } from "@/components/Chips";
import { IncomeTab } from "@/components/income/IncomeTab";
import { CatchUpTab } from "@/components/planned/CatchUpTab";
import { PlannedTab } from "@/components/planned/PlannedTab";
import { budgetHref, EXPENSES, LEDGER, parseBudgetView, type BudgetView } from "@/lib/budget-views";
import type { Business } from "@/lib/sorting";
import { loadBusinessTabs, loadCatchUp, loadIncome, loadPlanned } from "@/server/reports";

type Search = Record<string, string | string[] | undefined>;

export default async function BudgetPage({ searchParams }: { searchParams: Promise<Search> }) {
  const view = parseBudgetView(await searchParams);
  const businesses = await loadBusinessTabs();

  return (
    <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-20 pt-2 sm:px-6">
      <h1 className="sr-only">Budget</h1>
      <ViewTabs label="Budget views" items={subTabs(view, businesses)} className="mb-8 border-b border-rule" />
      {await viewContent(view)}
    </main>
  );
}

/** Income, Expenses and the Ledger (the owner, 2026-10-10), then one tab per business the owner has added. */
function subTabs(view: BudgetView, businesses: Business[]) {
  return [
    { label: "Income", href: budgetHref({ kind: "income", year: null }), current: view.kind === "income" },
    { label: "Expenses", href: budgetHref(EXPENSES), current: view.kind === "expenses" },
    { label: "Ledger", href: budgetHref(LEDGER), current: view.kind === "planned" },
    ...businesses.map((business) => ({
      label: business.name,
      href: budgetHref({ kind: "business", businessId: business.id, period: "monthly", by: "category" }),
      current: view.kind === "business" && view.businessId === business.id,
    })),
  ];
}

async function viewContent(view: BudgetView) {
  if (view.kind === "income") return <IncomeTab data={await loadIncome(view.year)} />;
  if (view.kind === "catch-up") return <CatchUpTab data={await loadCatchUp()} />;
  const tab =
    view.kind === "business"
      ? ({ kind: "business", businessId: view.businessId } as const)
      : ({ kind: "planned", personalOnly: view.personalOnly } as const);
  const data = await loadPlanned({ tab, period: view.period, by: view.by });
  return <PlannedTab data={data} mode={view.kind === "expenses" ? "expenses" : "ledger"} />;
}
