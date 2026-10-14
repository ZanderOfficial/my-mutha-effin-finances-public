// Income by calendar month for one year, built only from the deposits the database returned.

export type IncomeDeposit = {
  id: string;
  /** YYYY-MM-DD in the owner's calendar. */
  date: string;
  label: string;
  amountCents: number;
  pending: boolean;
  status: "income" | "not_income" | "unsorted";
  /** The business it is tagged with; null means personal. */
  businessId: string | null;
};

export type IncomeFilter = { kind: "all" } | { kind: "personal" } | { kind: "business"; businessId: string };

/** before_history and future months are unknown; a partial month is real but incomplete. */
export type MonthState = "before_history" | "partial" | "complete" | "future";

export type IncomeMonth = {
  /** YYYY-MM. */
  month: string;
  state: MonthState;
  /** Null when the month is unknown; a real $0.00 when known and empty. */
  totalCents: number | null;
  /** This month's income deposits that match the filter, oldest first. */
  deposits: IncomeDeposit[];
  /** Deposits still waiting for the owner, whatever the filter. */
  unsortedCount: number;
};

export type IncomeYear = {
  year: number;
  months: IncomeMonth[];
  totalCents: number | null;
  /** Mean over complete months only, rounded to the cent. */
  averageCents: number | null;
  highestMonth: string | null;
  lowestMonth: string | null;
};

export function incomeByMonth(input: {
  year: number;
  /** The owner's local date, YYYY-MM-DD. */
  today: string;
  historyStart: string | null;
  deposits: IncomeDeposit[];
  filter: IncomeFilter;
}): IncomeYear {
  const months = monthsOf(input.year).map((month) => buildMonth(month, input));
  const known = months.flatMap((m) => (m.totalCents === null ? [] : [m.totalCents]));
  const complete = months.filter((m) => m.state === "complete");

  return {
    year: input.year,
    months,
    totalCents: known.length > 0 ? sum(known) : null,
    averageCents: complete.length > 0 ? roundedMean(complete.map(totalOf)) : null,
    highestMonth: pickMonth(complete, (a, b) => a > b),
    lowestMonth: pickMonth(complete, (a, b) => a < b),
  };
}

/** Income made in a view's period: this month's total, or the year's so far. Null while unknown. */
export function madeIn(year: IncomeYear | null, period: "monthly" | "annual", today: string): number | null {
  if (year === null) return null;
  if (period === "annual") return year.totalCents;
  return year.months.find((month) => month.month === today.slice(0, 7))?.totalCents ?? null;
}

/** The years the switcher offers, oldest first: the first synced year to this one. Empty with no history. */
export function historyYears(historyStart: string | null, today: string): number[] {
  if (historyStart === null) return [];
  const first = Number(historyStart.slice(0, 4));
  const last = Number(today.slice(0, 4));
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) return [];
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** The requested year when the switcher offers it, otherwise this year. */
export function pickYear(requested: number | null, years: number[], today: string): number {
  if (requested !== null && years.includes(requested)) return requested;
  return Number(today.slice(0, 4));
}

function buildMonth(
  month: string,
  input: { today: string; historyStart: string | null; deposits: IncomeDeposit[]; filter: IncomeFilter },
): IncomeMonth {
  const state = monthState(month, input.today, input.historyStart);
  const inMonth = input.deposits.filter((d) => d.date.startsWith(month));
  const income = inMonth.filter((d) => d.status === "income" && matches(d, input.filter));
  const known = state === "partial" || state === "complete";

  return {
    month,
    state,
    totalCents: known ? sum(income.map((d) => d.amountCents)) : null,
    deposits: known ? income : [],
    unsortedCount: inMonth.filter((d) => d.status === "unsorted").length,
  };
}

/** YYYY-MM-DD strings compare correctly as text, so no date objects are needed. */
function monthState(month: string, today: string, historyStart: string | null): MonthState {
  const start = `${month}-01`;
  const next = nextMonthStart(month);
  if (start > today) return "future";
  if (historyStart === null || historyStart >= next) return "before_history";
  if (today < next || historyStart > start) return "partial";
  return "complete";
}

function matches(deposit: IncomeDeposit, filter: IncomeFilter): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "personal") return deposit.businessId === null;
  return deposit.businessId === filter.businessId;
}

/** The first month that beats every other; ties keep the earliest. */
function pickMonth(months: IncomeMonth[], beats: (a: number, b: number) => boolean): string | null {
  let best: IncomeMonth | null = null;
  for (const m of months) {
    if (best === null || beats(totalOf(m), totalOf(best))) best = m;
  }
  return best?.month ?? null;
}

function monthsOf(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

function nextMonthStart(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

const totalOf = (m: IncomeMonth): number => m.totalCents ?? 0;

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/** Integer-cent mean, half rounded up, with no fractional cents in between. */
export function roundedMean(values: number[]): number {
  const n = values.length;
  return Math.floor((2 * sum(values) + n) / (2 * n));
}
