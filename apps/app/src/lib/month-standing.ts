// The headline: this month's income against what the Ledger says the owner needs, less spending the plan does not cover.
import { actualOf, type BudgetActuals } from "./actuals";
import { formatCents } from "./money";
import { plannedBudget, type PlannedItem } from "./planned-budget";

export type MonthStanding = {
  /** Owner-sorted income this month. */
  incomeCents: number | null;
  /** The monthly items being paid. Null with nothing in the Ledger. */
  monthlyCents: number | null;
  /** The annual items being paid, a twelfth each month, rounded up to the cent. */
  setAsideCents: number | null;
  /** What the month needs: monthly items plus the annual set-aside. */
  needCents: number | null;
  /** Spending this month the plan does not cover: out of budget, unsorted, and lines over their plan. */
  extrasCents: number | null;
  /** Income minus need minus extras. Negative is a shortfall. */
  standingCents: number | null;
  /** Every real purchase this month, sorted or not. */
  spentCents: number | null;
  /** The part of spentCents not sorted yet. */
  unsortedCents: number | null;
};

/**
 * Decided by the owner on 2026-10-10: income in, minus everything the month needs, minus extras.
 * A line under its plan does not lower the figure, because the plan says that money is still needed.
 */
export function monthStanding(input: {
  incomeCents: number | null;
  items: PlannedItem[];
  /** This month's actuals: the Monthly view, everything. */
  actuals: BudgetActuals;
}): MonthStanding {
  const { incomeCents, items, actuals } = input;
  const needs = monthNeed(items);
  const extrasCents = extrasOf(items, actuals);
  const { needCents } = needs;
  const known = incomeCents !== null && needCents !== null && extrasCents !== null;
  return {
    incomeCents,
    ...needs,
    extrasCents,
    standingCents: known ? incomeCents - needCents - extrasCents : null,
    spentCents: actuals.periodSpentCents,
    unsortedCents: actuals.unsortedCents,
  };
}

/** Monthly items plus a twelfth of the annual items, from the same totals the Ledger shows. */
export function monthNeed(items: PlannedItem[]): Pick<MonthStanding, "monthlyCents" | "setAsideCents" | "needCents"> {
  const total = (view: "monthly" | "annual") => plannedBudget({ items, view, filter: { kind: "all" }, lineOf: () => null }).totalCents;
  const monthlyCents = total("monthly");
  const annualCents = total("annual");
  if (monthlyCents === null || annualCents === null) return { monthlyCents: null, setAsideCents: null, needCents: null };
  const setAsideCents = Math.ceil(annualCents / 12);
  return { monthlyCents, setAsideCents, needCents: monthlyCents + setAsideCents };
}

/** Out of budget, one-time, unsorted, and each monthly line's spending beyond its plan. Null while actuals are unknown. */
function extrasOf(items: PlannedItem[], actuals: BudgetActuals): number | null {
  if (actuals.outOfBudgetCents === null || actuals.oneTimeCents === null || actuals.unsortedCents === null) return null;
  const rows = plannedBudget({ items, view: "monthly", filter: { kind: "all" }, lineOf: () => null }).rows;
  const overspend = rows.map((row) => {
    const actual = actualOf(actuals, row.item.id) ?? 0;
    const covered = row.counts ? row.amountCents : 0;
    return Math.max(0, actual - covered);
  });
  return actuals.outOfBudgetCents + actuals.oneTimeCents + actuals.unsortedCents + overspend.reduce((a, b) => a + b, 0);
}

/** "$205 short with 21 days left." The headline in words; null while unknown. */
export function standingSentence(standingCents: number | null, daysLeft: number): string | null {
  if (standingCents === null) return null;
  const amount = formatCents(Math.abs(standingCents), { trimZeroCents: true });
  const days = daysLeft <= 0 ? "on the last day of the month" : `with ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
  if (standingCents < 0) return `${amount} short ${days}.`;
  if (standingCents > 0) return `${amount} ahead ${days}.`;
  return `Exactly covered ${days}.`;
}

/** How the month's need is made up, in words: "$1,400 of monthly items and $105 a month for annual ones". */
export function needWords(standing: MonthStanding): string | null {
  if (standing.monthlyCents === null || standing.setAsideCents === null) return null;
  const monthly = formatCents(standing.monthlyCents);
  if (standing.setAsideCents === 0) return `${monthly} of monthly items`;
  return `${monthly} of monthly items and ${formatCents(standing.setAsideCents)} a month for annual ones`;
}
