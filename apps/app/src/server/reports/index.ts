import { getOwnerId } from "@/server/auth";
import { isDatabaseConfigured, withOwner } from "@/server/db";
import { ownerTimezone } from "@/server/sync/timezone";
import {
  loadIncome as income,
  loadNetWorth as netWorth,
  loadOverview as overview,
  loadTransactions as transactions,
  type NetWorthView,
  type ReportDeps,
  type TransactionsQuery,
} from "./loaders";
import type { Range } from "@/lib/networth";
import {
  loadBusinessTabs as businessTabs,
  loadMiscCount as miscCount,
  loadCatchUp as catchUp,
  loadPlanned as planned,
  type PlannedQuery,
} from "./planned-loader";

export type { CatchUpData, PlannedData, PlannedQuery, PlannedTab } from "./planned-loader";

export { PAGE_SIZE, LATEST_COUNT } from "./loaders";
export type {
  Attention,
  IncomeData,
  NetWorthData,
  NetWorthView,
  OverviewData,
  TransactionsData,
  TransactionsQuery,
} from "./loaders";
export type { TxFlowFilter, TxRow } from "./repository";

/** Real dependencies: the signed-in owner, Neon through withOwner, the real clock. */
function deps(): ReportDeps {
  return {
    getOwner: getOwnerId,
    configured: isDatabaseConfigured,
    run: withOwner,
    now: () => new Date(),
    timezone: () => ownerTimezone(),
  };
}

export const loadOverview = () => overview(deps());
export const loadIncome = (year: number | null) => income(deps(), year);
export const loadPlanned = (query: PlannedQuery) => planned(deps(), query);
export const loadCatchUp = () => catchUp(deps());
export const loadBusinessTabs = () => businessTabs(deps());
export const loadMiscCount = () => miscCount(deps());
export const loadTransactions = (query: TransactionsQuery) => transactions(deps(), query);
export const loadNetWorth = (view: NetWorthView, range: Range) =>
  netWorth(deps(), view, range);
