// Loaders for the planned budget tabs: planned items against real spending, and the Misc count for the header.
import { budgetActuals, yearStart, type BudgetActuals, type BudgetTransaction } from "@/lib/actuals";
import { incomeByMonth, madeIn, type IncomeFilter, type IncomeYear } from "@/lib/income";
import { monthStanding, type MonthStanding } from "@/lib/month-standing";
import { yearFlow, type YearFlow } from "@/lib/year-flow";
import { plannedBudget, type PlannedBudget, type PlannedFilter, type PlannedItem, type PlannedView } from "@/lib/planned-budget";
import { groupBySource, type Business, type OneTimeKind, type SpendingRule, type UnsortedSource } from "@/lib/sorting";
import {
  labelTotals,
  lineKeyFor,
  type LabelledTotal,
  type ScheduleCForm,
  type TaxCategory,
  type TotalsBy,
} from "@/lib/tax-categories";
import type { Queryable } from "@/server/db";
import { readOneTimeKinds } from "@/server/sorting/one-time-kinds";
import { readBusinesses, readUnsortedDeposits } from "./income";
import { withData, type ReportDeps } from "./loaders";
import {
  readBudgetStart,
  readBudgetTransactions,
  readHasTransactions,
  readPlannedItems,
  readScheduleCForm,
  readSpendingRules,
  readTaxCategories,
} from "./planned";
import { readDepositsForYear } from "./repository";

/** The Planned tab (everything, or only personal items), or one business's tab. */
export type PlannedTab = { kind: "planned"; personalOnly: boolean } | { kind: "business"; businessId: string };

export type PlannedQuery = { tab: PlannedTab; period: PlannedView; by: TotalsBy };

export type PlannedData = PlannedQuery & {
  budget: PlannedBudget;
  /** Every planned item, whatever the tab shows, so spending can be moved to any of them. */
  allItems: PlannedItem[];
  /** The tab's totals in both views, for its header. Null when nothing is entered. */
  monthlyCents: number | null;
  annualCents: number | null;
  /** The current view's planned totals by tax category or Schedule C line, named for the screen. */
  totals: LabelledTotal[];
  /** Real spending in the view's period, checked against the planned items. */
  actuals: BudgetActuals;
  /** The same grouping of real spending, named for the screen. */
  actualTotals: LabelledTotal[];
  /** The first day budget checking covers, or null before it is set. */
  startDate: string | null;
  spendingRules: SpendingRule[];
  businesses: Business[];
  categories: TaxCategory[];
  /** The owner's own list for breaking down one-time spending. */
  oneTimeKinds: OneTimeKind[];
  /** The Schedule C lines categories can map to, or null when none are loaded. */
  scheduleC: ScheduleCForm | null;
  /** On a business tab, that business's income by month this year; null on the Planned tab or with no owner. */
  businessIncome: IncomeYear | null;
  /** Income made in the view's period (this month, or this year so far) for this tab's filter; null while unknown. */
  madeCents: number | null;
  /** This month's income against everything the Ledger needs; only on the Planned tab with every item shown. */
  standing: MonthStanding | null;
  /** The owner's local date. */
  today: string;
  /** Items can be saved: an owner is signed in and the database exists. */
  canEdit: boolean;
};

/** Everything one planned tab reads, straight from the database. */
type PlannedRows = {
  items: PlannedItem[];
  categories: TaxCategory[];
  businesses: Business[];
  oneTimeKinds: OneTimeKind[];
  scheduleC: ScheduleCForm | null;
  transactions: BudgetTransaction[];
  startDate: string | null;
  spendingRules: SpendingRule[];
  dataKnown: boolean;
  today: string;
  /** This tab's income by month this year; null with no owner. */
  income: IncomeYear | null;
};

export function loadPlanned(deps: ReportDeps, query: PlannedQuery): Promise<PlannedData> {
  return withData(deps, buildPlanned(query, blankRows(deps.now()), false), async (tx, ownerId, w) => {
    const businesses = await readBusinesses(tx, ownerId);
    const tab = knownTab(query.tab, businesses);
    const rows = await readPlannedRows(tx, ownerId, w.today, businesses, tab);
    return buildPlanned({ ...query, tab }, rows, true);
  });
}

/** The one-time catch-up on the year so far: every month's made, spent and kept, and what is left to sort. */
export type CatchUpData = {
  /** The whole Ledger over the year so far, with Misc reaching back to January 1. */
  planned: PlannedData;
  flow: YearFlow | null;
  /** Deposits from any time still waiting to be marked Income or Not income. */
  unsorted: UnsortedSource[];
};

const CATCH_UP: PlannedQuery = { tab: { kind: "planned", personalOnly: false }, period: "annual", by: "category" };

export function loadCatchUp(deps: ReportDeps): Promise<CatchUpData> {
  const blank = { planned: buildPlanned(CATCH_UP, blankRows(deps.now()), false), flow: null, unsorted: [] };
  return withData(deps, blank, async (tx, ownerId, w) => {
    const businesses = await readBusinesses(tx, ownerId);
    const rows = await readPlannedRows(tx, ownerId, w.today, businesses, CATCH_UP.tab);
    // Checking starts at the start date; the catch-up sorts the rest of the year once, so its Misc starts in January.
    const caughtUp = { ...rows, startDate: rows.startDate === null ? null : earliest(rows.startDate, w.today) };
    const planned = buildPlanned(CATCH_UP, caughtUp, true);
    return {
      planned,
      flow: rows.income ? yearFlow(rows.income, planned.actuals.spending) : null,
      unsorted: groupBySource(await readUnsortedDeposits(tx, ownerId)),
    };
  });
}

/** The owner's businesses, which become Budget sub-tabs. */
export function loadBusinessTabs(deps: ReportDeps): Promise<Business[]> {
  return withData(deps, [], (tx, ownerId) => readBusinesses(tx, ownerId));
}

/** How many transactions wait in Misc, for the Budget tab's badge. Null when unknown. */
export function loadMiscCount(deps: ReportDeps): Promise<number | null> {
  return withData(deps, null, async (tx, ownerId, w) => {
    const startDate = await readBudgetStart(tx, ownerId);
    if (startDate === null) return null;
    const actuals = budgetActuals({
      items: await readPlannedItems(tx, ownerId),
      transactions: await readBudgetTransactions(tx, ownerId, earliest(startDate, w.today)),
      startDate,
      today: w.today,
      view: "monthly",
      filter: { kind: "all" },
      lineOf: () => null,
      dataKnown: await readHasTransactions(tx, ownerId),
    });
    return actuals.period ? actuals.miscCount : null;
  });
}

async function readPlannedRows(
  tx: Queryable,
  ownerId: string,
  today: string,
  businesses: Business[],
  tab: PlannedTab,
): Promise<PlannedRows> {
  const startDate = await readBudgetStart(tx, ownerId);
  return {
    items: await readPlannedItems(tx, ownerId),
    categories: await readTaxCategories(tx, ownerId),
    businesses,
    oneTimeKinds: await readOneTimeKinds(tx, ownerId),
    scheduleC: await readScheduleCForm(tx),
    transactions: startDate === null ? [] : await readBudgetTransactions(tx, ownerId, earliest(startDate, today)),
    startDate,
    spendingRules: await readSpendingRules(tx, ownerId),
    dataKnown: await readHasTransactions(tx, ownerId),
    today,
    income: await readTabIncome(tx, ownerId, today, tab),
  };
}

/** Where to read spending from: the start of this year, or the start date if that is earlier. */
function earliest(startDate: string, today: string): string {
  const year = yearStart(today);
  return startDate < year ? startDate : year;
}

/** The tab's income by month for this calendar year, sorted as the Income tab sorts it. */
async function readTabIncome(tx: Queryable, ownerId: string, today: string, tab: PlannedTab): Promise<IncomeYear> {
  const year = Number(today.slice(0, 4));
  const { historyStart, deposits } = await readDepositsForYear(tx, ownerId, year);
  return incomeByMonth({ year, today, historyStart, deposits, filter: incomeFilterFor(tab) });
}

/** No owner or database: nothing entered, nothing synced, so every figure is unknown. */
function blankRows(now: Date): PlannedRows {
  return {
    items: [],
    categories: [],
    businesses: [],
    oneTimeKinds: [],
    scheduleC: null,
    transactions: [],
    startDate: null,
    spendingRules: [],
    dataKnown: false,
    today: now.toISOString().slice(0, 10),
    income: null,
  };
}

function buildPlanned(query: PlannedQuery, rows: PlannedRows, canEdit: boolean): PlannedData {
  const filter = filterFor(query.tab);
  const lineOf = lineKeyFor(rows.categories);
  const budgetFor = (view: PlannedView) => plannedBudget({ items: rows.items, view, filter, lineOf });
  const budget = budgetFor(query.period);
  const actuals = budgetActuals({ ...rows, view: query.period, filter, lineOf });
  const byCategory = query.by === "category";
  return {
    ...query,
    budget,
    allItems: rows.items,
    monthlyCents: budgetFor("monthly").totalCents,
    annualCents: budgetFor("annual").totalCents,
    totals: labelTotals(byCategory ? budget.byCategory : budget.byLine, query.by, rows.categories),
    actuals,
    actualTotals: labelTotals(byCategory ? actuals.byCategory : actuals.byLine, query.by, rows.categories),
    startDate: rows.startDate,
    spendingRules: rows.spendingRules,
    businesses: rows.businesses,
    categories: rows.categories,
    oneTimeKinds: rows.oneTimeKinds,
    scheduleC: rows.scheduleC,
    businessIncome: query.tab.kind === "business" ? rows.income : null,
    madeCents: madeIn(rows.income, query.period, rows.today),
    standing: wholeLedger(query.tab) ? standingOf(rows, filter, lineOf) : null,
    today: rows.today,
    canEdit,
  };
}

/** This month's standing, with this month's actuals for every item whatever the view. */
function standingOf(rows: PlannedRows, filter: PlannedFilter, lineOf: (categoryId: string | null) => string | null): MonthStanding {
  const actuals = budgetActuals({ ...rows, view: "monthly", filter, lineOf });
  return monthStanding({ incomeCents: madeIn(rows.income, "monthly", rows.today), items: rows.items, actuals });
}

const wholeLedger = (tab: PlannedTab) => tab.kind === "planned" && !tab.personalOnly;

/** This month's income against the Ledger's need, for the Overview. Unknown without a start date. */
export async function readMonthStanding(tx: Queryable, ownerId: string, today: string, incomeCents: number | null): Promise<MonthStanding> {
  const startDate = await readBudgetStart(tx, ownerId);
  const items = await readPlannedItems(tx, ownerId);
  const actuals = budgetActuals({
    items,
    transactions: startDate === null ? [] : await readBudgetTransactions(tx, ownerId, earliest(startDate, today)),
    startDate,
    today,
    view: "monthly",
    filter: { kind: "all" },
    lineOf: () => null,
    dataKnown: await readHasTransactions(tx, ownerId),
  });
  return monthStanding({ incomeCents, items, actuals });
}

/** A business tab for a business that no longer exists falls back to the Planned tab. */
function knownTab(tab: PlannedTab, businesses: Business[]): PlannedTab {
  if (tab.kind === "business" && !businesses.some((b) => b.id === tab.businessId)) {
    return { kind: "planned", personalOnly: false };
  }
  return tab;
}

/** The income that pays for this tab's plan: everything, personal only, or one business's. */
function incomeFilterFor(tab: PlannedTab): IncomeFilter {
  if (tab.kind === "business") return { kind: "business", businessId: tab.businessId };
  return tab.personalOnly ? { kind: "personal" } : { kind: "all" };
}

function filterFor(tab: PlannedTab): PlannedFilter {
  if (tab.kind === "business") return { kind: "business", businessId: tab.businessId };
  return tab.personalOnly ? { kind: "personal" } : { kind: "all" };
}
