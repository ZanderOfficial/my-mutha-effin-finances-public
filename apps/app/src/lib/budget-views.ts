// Which Budget sub-tab a query string asks for, and the link to each one.
import type { PlannedView } from "./planned-budget";
import type { TotalsBy } from "./tax-categories";

type Query = Record<string, string | string[] | undefined>;

export type PlannedOptions = { period: PlannedView; by: TotalsBy };

/**
 * Expenses (the default) checks this month's spending against the Ledger; the Ledger ("planned", where
 * the budget is edited) and a business tab show the items; Income shows deposits.
 */
export type BudgetView =
  | ({ kind: "expenses"; personalOnly: boolean } & PlannedOptions)
  | { kind: "income"; year: number | null }
  | { kind: "catch-up" }
  | ({ kind: "planned"; personalOnly: boolean } & PlannedOptions)
  | ({ kind: "business"; businessId: string } & PlannedOptions);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Anything unrecognised falls back to Expenses, never an error. "planned" is the Ledger's old name. */
export function parseBudgetView(query: Query): BudgetView {
  const view = first(query.view);
  const personalOnly = first(query.for) === "personal";
  if (view === "income") return { kind: "income", year: parseYear(first(query.year)) };
  if (view === "catch-up") return { kind: "catch-up" };
  if (view === "ledger" || view === "planned") return { kind: "planned", personalOnly, ...plannedOptions(query) };
  const businessId = first(query.business);
  if (view === "business" && businessId && UUID.test(businessId)) return { kind: "business", businessId, ...plannedOptions(query) };
  return { kind: "expenses", personalOnly, ...plannedOptions(query) };
}

/** The link to a view, leaving defaults out so links stay short. */
export function budgetHref(view: BudgetView): string {
  const params = new URLSearchParams();
  if (view.kind === "income") {
    params.set("view", "income");
    if (view.year !== null) params.set("year", String(view.year));
  }
  if (view.kind === "planned") params.set("view", "ledger");
  if (view.kind === "catch-up") params.set("view", "catch-up");
  if (view.kind === "business") {
    params.set("view", "business");
    params.set("business", view.businessId);
  }
  if ((view.kind === "planned" || view.kind === "expenses") && view.personalOnly) params.set("for", "personal");
  if (view.kind !== "income" && view.kind !== "catch-up") {
    if (view.period === "annual") params.set("period", "annual");
    if (view.by === "line") params.set("by", "line");
  }
  const text = params.toString();
  return text ? `/budget?${text}` : "/budget";
}

/** The Expenses tab with its defaults: this month, everything. */
export const EXPENSES: BudgetView = { kind: "expenses", personalOnly: false, period: "monthly", by: "category" };

/** The Ledger with its defaults. */
export const LEDGER: BudgetView = { kind: "planned", personalOnly: false, period: "monthly", by: "category" };

function plannedOptions(query: Query): PlannedOptions {
  return {
    period: first(query.period) === "annual" ? "annual" : "monthly",
    by: first(query.by) === "line" ? "line" : "category",
  };
}

/** A four-digit year, or null; the income loader checks it is one the switcher offers. */
function parseYear(text: string | undefined): number | null {
  return text && /^\d{4}$/.test(text) ? Number(text) : null;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
