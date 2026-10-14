import { gapCents } from "@/lib/flow";
import { countedSpending } from "@/lib/actuals";
import { historyYears, incomeByMonth, pickYear, type IncomeYear } from "@/lib/income";
import { yearFlow, type YearFlow } from "@/lib/year-flow";
import {
  allocationByType,
  withShares,
  type AllocationSlice,
  type HoldingRow,
} from "@/lib/invest";
import type { MonthWindow } from "@/lib/month";
import {
  rangeDelta,
  rangeStartDate,
  splitAccounts,
  type NetWorthPoint,
  type Range,
  type RangeDelta,
} from "@/lib/networth";
import { groupBySource, type Business, type HandSortedDeposit, type SourceRule, type UnsortedSource } from "@/lib/sorting";
import type { Queryable } from "@/server/db";
import { readBusinesses, readHandSorted, readSourceRules, readUnsortedDeposits } from "./income";
import {
  readAccounts,
  readDebts,
  readDepositsForYear,
  readHistoryStart,
  readHoldings,
  readItems,
  readLatestNetWorth,
  readLatestTransactions,
  readMonthFlow,
  readNetWorthSeries,
  readTransactionsPage,
  type AccountLine,
  type DebtLine,
  type MonthFlow,
  type NetWorthDay,
  type TxFlowFilter,
  type TxRow,
} from "./repository";
import { readBudgetTransactions } from "./planned";
import { readMonthStanding } from "./planned-loader";
import { monthWindowAt } from "./window";
import { unknownActuals } from "@/lib/actuals";
import { monthStanding, type MonthStanding } from "@/lib/month-standing";

/**
 * One loader per screen. Each is honest by construction: with no owner, no
 * database or no rows it returns the BLANK shape (nulls and empty lists), which
 * the screens draw as dashes, empty tracks and "Nothing here yet". The database
 * is only reached through `deps.run` (withOwner) after `deps.getOwner()` proved
 * the viewer is the owner. Errors from the database are not swallowed: a
 * failing query must not look like an empty account.
 */
export type ReportDeps = {
  getOwner: () => Promise<string | null>;
  configured: () => boolean;
  run: <T>(ownerId: string, fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  now: () => Date;
  /** OWNER_TIMEZONE; only called once an owner and database exist. */
  timezone: () => string;
};

export async function withData<T>(
  deps: ReportDeps,
  blank: T,
  fn: (tx: Queryable, ownerId: string, today: MonthWindow) => Promise<T>,
): Promise<T> {
  const ownerId = await deps.getOwner();
  if (!ownerId || !deps.configured()) return blank;
  const window = monthWindowAt(deps.now(), deps.timezone());
  return deps.run(ownerId, (tx) => fn(tx, ownerId, window));
}

const BLANK_FLOW: MonthFlow = {
  dataKnown: false,
  incomeCents: null,
  spendingCents: null,
  pendingCount: 0,
  unsortedCount: 0,
  prevSpendingCents: null,
};

/* ---------------------------------- Overview --------------------------------- */

export type Attention = { id: string; institutionName: string | null; status: string };

export type OverviewData = {
  window: MonthWindow | null;
  flow: MonthFlow;
  gapCents: number | null;
  /** Income against everything the Ledger needs this month, less extras: the headline. */
  standing: MonthStanding;
  netWorth: NetWorthDay | null;
  /** Last month of net worth, oldest first, for the sparkline. */
  series: NetWorthPoint[];
  latest: TxRow[];
  /** Items that are not healthy. */
  attention: Attention[];
  /** Null when unknown (no owner or database). */
  linkedCount: number | null;
};

const BLANK_OVERVIEW: OverviewData = {
  window: null,
  flow: BLANK_FLOW,
  gapCents: null,
  standing: monthStanding({ incomeCents: null, items: [], actuals: unknownActuals() }),
  netWorth: null,
  series: [],
  latest: [],
  attention: [],
  linkedCount: null,
};

export const LATEST_COUNT = 5;

export function loadOverview(deps: ReportDeps): Promise<OverviewData> {
  return withData(deps, BLANK_OVERVIEW, async (tx, ownerId, w) => {
    const flow = await readMonthFlow(tx, ownerId, w);
    const netWorth = await readLatestNetWorth(tx, ownerId);
    const seriesFrom = rangeStartDate(w.today, "1M");
    const series = (await readNetWorthSeries(tx, ownerId, seriesFrom)).map(toPoint);
    const latest = await readLatestTransactions(tx, ownerId, LATEST_COUNT);
    const items = await readItems(tx, ownerId);
    return {
      window: w,
      flow,
      gapCents: gapCents(flow.incomeCents, flow.spendingCents),
      standing: await readMonthStanding(tx, ownerId, w.today, flow.incomeCents),
      netWorth,
      series,
      latest,
      attention: items.filter((i) => i.status !== "active"),
      linkedCount: items.length,
    };
  });
}

function toPoint(d: NetWorthDay): NetWorthPoint {
  return { date: d.date, netWorthCents: d.netWorthCents };
}

/* ----------------------------------- Income ---------------------------------- */

export type IncomeData = {
  year: number;
  /** The years the switcher offers, oldest first. Empty with no history. */
  years: number[];
  income: IncomeYear;
  /** The year's income against every real purchase, month by month, and what was left over. Null with no owner. */
  flow: YearFlow | null;
  unsorted: UnsortedSource[];
  rules: SourceRule[];
  /** Deposits in the shown year that the owner decided one at a time. */
  handSorted: HandSortedDeposit[];
  businesses: Business[];
  /** Sorting can be saved: an owner is signed in and the database exists. */
  canEdit: boolean;
};

/** No owner or database: every month is unknown and nothing can be sorted. */
function blankIncome(now: Date): IncomeData {
  const today = now.toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  return {
    year,
    years: [],
    income: incomeByMonth({ year, today, historyStart: null, deposits: [], filter: { kind: "all" } }),
    flow: null,
    unsorted: [],
    rules: [],
    handSorted: [],
    businesses: [],
    canEdit: false,
  };
}

export function loadIncome(deps: ReportDeps, requestedYear: number | null): Promise<IncomeData> {
  return withData(deps, blankIncome(deps.now()), async (tx, ownerId, w) => {
    const historyStart = await readHistoryStart(tx, ownerId);
    const years = historyYears(historyStart, w.today);
    const year = pickYear(requestedYear, years, w.today);
    const { deposits } = await readDepositsForYear(tx, ownerId, year);
    const income = incomeByMonth({ year, today: w.today, historyStart, deposits, filter: { kind: "all" } });
    return {
      year,
      years,
      income,
      flow: yearFlow(income, countedSpending(await readBudgetTransactions(tx, ownerId, `${year}-01-01`))),
      unsorted: groupBySource(await readUnsortedDeposits(tx, ownerId)),
      rules: await readSourceRules(tx, ownerId),
      handSorted: await readHandSorted(tx, ownerId, year),
      businesses: await readBusinesses(tx, ownerId),
      canEdit: true,
    };
  });
}

/* -------------------------------- Transactions ------------------------------- */

export const PAGE_SIZE = 50;

export type TransactionsQuery = { flow: TxFlowFilter; q: string; page: number };

export type TransactionsData = {
  query: TransactionsQuery;
  rows: TxRow[];
  /** Matching rows across all pages. Null when unknown (no owner or database). */
  total: number | null;
  pageSize: number;
};

export function loadTransactions(
  deps: ReportDeps,
  query: TransactionsQuery,
): Promise<TransactionsData> {
  const blank: TransactionsData = { query, rows: [], total: null, pageSize: PAGE_SIZE };
  return withData(deps, blank, async (tx, ownerId) => {
    const { rows, total } = await readTransactionsPage(tx, ownerId, {
      ...query,
      pageSize: PAGE_SIZE,
    });
    return { query, rows, total, pageSize: PAGE_SIZE };
  });
}

/* ---------------------------------- Net worth -------------------------------- */

export type NetWorthView = "summary" | "investments" | "debts";

export type NetWorthData = {
  view: NetWorthView;
  range: Range;
  latest: NetWorthDay | null;
  series: NetWorthPoint[];
  delta: RangeDelta | null;
  assets: AccountLine[];
  liabilities: AccountLine[];
  holdings: HoldingRow[];
  slices: AllocationSlice[];
  debts: DebtLine[];
};

function blankNetWorth(view: NetWorthView, range: Range): NetWorthData {
  return {
    view,
    range,
    latest: null,
    series: [],
    delta: null,
    assets: [],
    liabilities: [],
    holdings: [],
    slices: [],
    debts: [],
  };
}

export function loadNetWorth(
  deps: ReportDeps,
  view: NetWorthView,
  range: Range,
): Promise<NetWorthData> {
  return withData(deps, blankNetWorth(view, range), async (tx, ownerId, w) => {
    const data = blankNetWorth(view, range);
    data.latest = await readLatestNetWorth(tx, ownerId);
    if (view === "summary") {
      const days = await readNetWorthSeries(tx, ownerId, rangeStartDate(w.today, range));
      data.series = days.map(toPoint);
      data.delta = rangeDelta(data.series);
      const split = splitAccounts(await readAccounts(tx, ownerId));
      data.assets = split.assets;
      data.liabilities = split.liabilities;
    } else if (view === "investments") {
      const holdings = await readHoldings(tx, ownerId);
      data.holdings = withShares(holdings);
      data.slices = allocationByType(holdings);
    } else {
      data.debts = await readDebts(tx, ownerId);
    }
    return data;
  });
}

