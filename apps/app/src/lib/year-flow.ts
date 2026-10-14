// Each month of the year: what came in, what went out, and what was kept, so a month that spent past its income shows.
import type { IncomeMonth, IncomeYear, MonthState } from "./income";

export type FlowMonth = {
  /** YYYY-MM. */
  month: string;
  state: MonthState;
  /** Owner-sorted income; null when the month is unknown (before history, or still to come). */
  madeCents: number | null;
  /** Every real purchase, sorted or not; null when the month is unknown. */
  spentCents: number | null;
  /** Made minus spent. Negative means the month spent more than it made. */
  keptCents: number | null;
  /** Deposits still waiting to be sorted, so a low income figure is explained. */
  depositsToSort: number;
};

export type YearFlow = {
  year: number;
  months: FlowMonth[];
  /** Totals over the known months; null with none. */
  madeCents: number | null;
  spentCents: number | null;
  keptCents: number | null;
  /** How many known months spent more than they made. */
  overMonths: number;
};

/**
 * One row per month, from the Income tab's months and the year's spending (already free of transfers,
 * card payments and charges that count nowhere). A month is known exactly when its income is.
 */
export function yearFlow(income: IncomeYear, spending: { date: string; amountCents: number }[]): YearFlow {
  const months = income.months.map((month) => flowOf(month, spending));
  const known = months.filter((month) => month.keptCents !== null);
  const total = (pick: (month: FlowMonth) => number | null) =>
    known.length === 0 ? null : known.reduce((sum, month) => sum + (pick(month) ?? 0), 0);
  return {
    year: income.year,
    months,
    madeCents: total((month) => month.madeCents),
    spentCents: total((month) => month.spentCents),
    keptCents: total((month) => month.keptCents),
    overMonths: known.filter((month) => (month.keptCents ?? 0) < 0).length,
  };
}

function flowOf(month: IncomeMonth, spending: { date: string; amountCents: number }[]): FlowMonth {
  const base = { month: month.month, state: month.state, depositsToSort: month.unsortedCount };
  if (month.totalCents === null) return { ...base, madeCents: null, spentCents: null, keptCents: null };
  const spentCents = spending
    .filter((charge) => charge.date.startsWith(month.month) && charge.amountCents < 0)
    .reduce((sum, charge) => sum - charge.amountCents, 0);
  return { ...base, madeCents: month.totalCents, spentCents, keptCents: month.totalCents - spentCents };
}
