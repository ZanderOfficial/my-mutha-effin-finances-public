// What the Income tab shows about sorting: deposits waiting by source, the owner's rules and businesses.

export type Business = { id: string; name: string };

/** One entry in the owner's own list for breaking down one-time spending (Eating out, Clothes, ...). */
export type OneTimeKind = { id: string; name: string };

export type UnsortedDeposit = {
  id: string;
  /** YYYY-MM-DD in the owner's calendar. */
  date: string;
  /** The bank's description, which tells deposits from one source apart. */
  name: string;
  /** The merchant if Plaid named one, else the description. */
  label: string;
  amountCents: number;
  pending: boolean;
  sourceKey: string;
};

/** What grouping by source needs from a row. */
type Groupable = { id: string; date: string; label: string; amountCents: number; sourceKey: string };

/** One source's rows: unsorted deposits on the Income tab, or one merchant's Misc spending. */
export type SourceGroup<T extends Groupable> = {
  sourceKey: string;
  /** The latest row's label. */
  label: string;
  count: number;
  totalCents: number;
  latestDate: string;
  /** Newest first. */
  rows: T[];
};

export type UnsortedSource = SourceGroup<UnsortedDeposit>;

export type SourceRule = {
  id: string;
  sourceKey: string;
  /** The latest deposit's label, or the source key when none is left. */
  label: string;
  kind: "income" | "not_income";
  businessName: string | null;
  depositCount: number;
};

/** A merchant's spending rule (M9), described for the rules list. */
export type SpendingRule = {
  id: string;
  sourceKey: string;
  /** The merchant's latest label, or the key when no spending is left. */
  label: string;
  /** Where its spending goes, in words: a line item's name, or "Out of budget" with its tag. */
  target: string;
  spendingCount: number;
};

/** A deposit the owner decided on its own, without a rule. */
export type HandSortedDeposit = {
  id: string;
  date: string;
  label: string;
  amountCents: number;
  kind: "income" | "not_income";
  businessName: string | null;
};

/** Groups rows by source, the biggest total first. */
/** How many deposits wait across the sources: a count of transactions, never a sum of money. */
export function depositsWaiting(sources: { count: number }[]): number {
  return sources.reduce((total, source) => total + source.count, 0);
}

export function groupBySource<T extends Groupable>(rows: T[]): SourceGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.sourceKey);
    if (group) group.push(row);
    else groups.set(row.sourceKey, [row]);
  }
  return [...groups.entries()].map(([sourceKey, group]) => toGroup(sourceKey, group)).sort(biggestFirst);
}

function toGroup<T extends Groupable>(sourceKey: string, group: T[]): SourceGroup<T> {
  const rows = [...group].sort(newestFirst);
  return {
    sourceKey,
    label: rows[0].label,
    count: rows.length,
    totalCents: rows.reduce((total, row) => total + row.amountCents, 0),
    latestDate: rows[0].date,
    rows,
  };
}

function newestFirst(a: Groupable, b: Groupable): number {
  return a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1;
}

function biggestFirst(a: SourceGroup<Groupable>, b: SourceGroup<Groupable>): number {
  return b.totalCents - a.totalCents || a.label.localeCompare(b.label);
}
