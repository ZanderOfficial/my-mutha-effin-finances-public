// Planned against actual: where each spending transaction goes, what each line item really cost, and the Misc pile.
import { isFlowExcluded } from "./flow";
import { monthWindow } from "./month";
import { inFilter, type GroupTotal, type PlannedFilter, type PlannedItem, type PlannedView } from "./planned-budget";
import { isLarge, learnFromDecisions } from "./learning";
import { groupBySource, type SourceGroup } from "./sorting";

/**
 * Where the owner put spending: a planned item (or sub-item), or off the plan with optional tags: out of
 * budget, or one-time (real spending the owner does not expect to repeat, the owner's 2026-10-10 decision).
 */
export type Placement =
  | { kind: "planned_item"; plannedItemId: string }
  | { kind: "out_of_budget"; businessId: string | null; taxCategoryId: string | null }
  /** oneTimeKindId: what it was, from the owner's own list (Eating out, Clothes, ...); null when not named. */
  | { kind: "one_time"; businessId: string | null; taxCategoryId: string | null; oneTimeKindId: string | null };

/** Spending off the plan: it carries its own "For" tag and tax category. */
export type OffPlan = Exclude<Placement, { kind: "planned_item" }>;

export function isOffPlan(placement: Placement): placement is OffPlan {
  return placement.kind !== "planned_item";
}

export type BudgetTransaction = {
  id: string;
  /** YYYY-MM-DD in the owner's calendar. */
  date: string;
  label: string;
  /** The bank's description, which tells a merchant's transactions apart. */
  name: string;
  sourceKey: string;
  /** Spending negative, money in positive. */
  amountCents: number;
  pending: boolean;
  category: string | null;
  categoryDetail: string | null;
  /** Money in that the owner's income sorting counts as income; it is never a refund. */
  countedAsIncome: boolean;
  /** Half of a move between the owner's own accounts (lib/flow's isOwnTransfer). */
  ownTransfer: boolean;
  /** The owner marked it not spending: money that left and came back. */
  markedNotSpending?: boolean;
  /** The owner marked it, or its merchant, a transfer to one of their own accounts. */
  markedTransfer?: boolean;
  /** A decision about this transaction alone. It beats the rule. */
  choice: Placement | null;
  /** The merchant's spending rule. */
  rule: Placement | null;
  /** Set by budgetActuals: where the owner's past choices place it, when it has no choice or rule of its own. */
  auto?: Placement;
  /** Set by budgetActuals on a charge too large to place unasked: the merchant's usual charge. */
  usualCents?: number;
};

/** One Misc transaction. Its amount is what was spent, as positive cents. */
export type MiscTransaction = Omit<BudgetTransaction, "choice" | "rule" | "countedAsIncome" | "ownTransfer" | "auto" | "markedNotSpending" | "markedTransfer">;

export type Period = { start: string; endExclusive: string };

export type BudgetActuals = {
  /** The dates actuals cover; null until anything has synced and budget checking has started. */
  period: Period | null;
  /** Spent minus refunds in the period, per item id. A parent includes its sub-items. */
  actualByItem: Record<string, number>;
  /** The period's transactions matched to each item id, newest first. A parent lists its sub-items' too. */
  matchedByItem: Record<string, BudgetTransaction[]>;
  /** The period's out-of-budget spending in this view's filter, newest first. */
  outOfBudget: BudgetTransaction[];
  outOfBudgetCents: number | null;
  /** The period's one-time spending in this view's filter, newest first; it counts like out of budget. */
  oneTime: BudgetTransaction[];
  oneTimeCents: number | null;
  /** The one-time spending by the owner's one-time kind id (null for none named), biggest first. */
  oneTimeByKind: GroupTotal[];
  /** The period's charges the owner marked not spending, newest first; they count nowhere. */
  notSpending: BudgetTransaction[];
  /** The period's charges the owner marked transfers to their own accounts, newest first; they count nowhere. */
  transfers: BudgetTransaction[];
  /** Items in the view's filter (greyed out ones too) plus out of budget. Null when unknown. */
  totalCents: number | null;
  /**
   * The period's spending that is placed nowhere yet: Misc, and spending before the start date with no
   * choice or rule. Never filtered, since it has no "For" tag. Null when unknown.
   */
  unsortedCents: number | null;
  /**
   * Everything really spent in the period: placed spending in the filter, whatever its frequency, plus
   * the unsorted spending when the filter is everything. What the hero's Spent shows. Null when unknown.
   */
  periodSpentCents: number | null;
  /**
   * What Standing compares with the planned total: the part of totalCents matched to line items being
   * paid. Out of budget, one-time and not-paying items' matches show in Spent but not here. Null when unknown.
   */
  plannedSpentCents: number | null;
  /** The total by tax category id and by Schedule C line key, as in lib/planned-budget. Biggest first. */
  byCategory: GroupTotal[];
  byLine: GroupTotal[];
  /** Every expense in the period wherever it sits (placed, auto, or in Misc), newest first. Never filtered. */
  spending: BudgetTransaction[];
  /** Spending since the start date that fits nowhere yet, by merchant. Never filtered. */
  misc: SourceGroup<MiscTransaction>[];
  miscCount: number;
};

type Input = {
  items: PlannedItem[];
  /** Non-removed transactions from the start of the view's period (or the start date, if earlier) on. */
  transactions: BudgetTransaction[];
  /** The first day budget checking covers; null before it is set. */
  startDate: string | null;
  /** The owner's local date. */
  today: string;
  view: PlannedView;
  filter: PlannedFilter;
  lineOf: (taxCategoryId: string | null) => string | null;
  /** Whether any transaction has synced at all. */
  dataKnown: boolean;
};

/** One transaction's effect on one place: what it cost there, and which tax category it counts under. */
type Effect = { transaction: BudgetTransaction; placement: Placement; costCents: number; taxCategoryId: string | null };

export function budgetActuals(input: Input): BudgetActuals {
  const { startDate } = input;
  const period = periodFor(input);
  if (!period || startDate === null) return unknownActuals();

  const items = new Map(input.items.map((item) => [item.id, item]));
  const transactions = withLearning(input.transactions, items);
  const effects = transactions.flatMap((t) => effectOf(t, items));
  const inPeriod = effects.filter((e) => within(e.transaction.date, period));
  const inView = inPeriod.filter((e) => inViewOf(e.placement, items, input.view) && inFilter(tagsOf(e.placement, items), input.filter));
  const outOfBudget = inView.filter((e) => e.placement.kind === "out_of_budget");
  const oneTime = inView.filter((e) => e.placement.kind === "one_time");
  const inFilterAnyView = inPeriod.filter((e) => inFilter(tagsOf(e.placement, items), input.filter));
  const unsortedCents = unsortedSpending(transactions, period, items);

  return {
    period,
    actualByItem: actualByItem(inPeriod, items),
    matchedByItem: matchedByItem(inPeriod, items),
    outOfBudget: outOfBudget.map((e) => e.transaction),
    outOfBudgetCents: sum(outOfBudget.map((e) => e.costCents)),
    oneTime: oneTime.map((e) => e.transaction),
    oneTimeCents: sum(oneTime.map((e) => e.costCents)),
    oneTimeByKind: groupTotals(oneTime, (e) => (e.placement.kind === "one_time" ? e.placement.oneTimeKindId : null)),
    notSpending: transactions.filter((t) => t.markedNotSpending && within(t.date, period)),
    transfers: transactions.filter((t) => t.markedTransfer && within(t.date, period)),
    spending: transactions.filter((t) => t.amountCents < 0 && within(t.date, period) && !notSpending(t)),
    totalCents: sum(inView.map((e) => e.costCents)),
    unsortedCents,
    periodSpentCents: sum(inFilterAnyView.map((e) => e.costCents)) + (input.filter.kind === "all" ? unsortedCents : 0),
    plannedSpentCents: sum(inView.filter((e) => isPaying(e.placement, items)).map((e) => e.costCents)),
    byCategory: groupTotals(inView, (e) => e.taxCategoryId),
    byLine: groupTotals(inView, (e) => input.lineOf(e.taxCategoryId)),
    ...miscPile(transactions, startDate, input.today, items),
  };
}

/**
 * The view's dates: this month for Monthly, the whole year so far for Annual. Spending before the start
 * date still counts in Spent (the owner, 2026-10-10); only the Misc pile starts at the start date.
 * Before anything has synced, or before checking starts, there are no actuals at all.
 */
function periodFor(input: Input): Period | null {
  if (!input.dataKnown || input.startDate === null) return null;
  const month = monthWindow(input.today);
  const start = input.view === "monthly" ? month.start : yearStart(input.today);
  return { start, endExclusive: month.endExclusive };
}

/** The first day of the owner's year: where an Annual view's spending starts. */
export function yearStart(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

const within = (date: string, period: Period) => date >= period.start && date < period.endExclusive;

/** Spending in the period with no choice or rule (or one whose line item is gone), as positive cents. */
function unsortedSpending(transactions: BudgetTransaction[], period: Period, items: Map<string, PlannedItem>): number {
  const loose = transactions.filter(
    (t) => t.amountCents < 0 && within(t.date, period) && !notSpending(t) && !isPlaced(t, items),
  );
  return sum(loose.map((t) => -t.amountCents));
}

/** Every real purchase among these transactions, sorted or not: what Spent counts, before any period. */
export function countedSpending(transactions: BudgetTransaction[]): BudgetTransaction[] {
  return transactions.filter((t) => t.amountCents < 0 && !notSpending(t));
}

/** Transfers, card payments, own-account moves the owner has not placed, and charges marked not spending never count. */
function notSpending(t: BudgetTransaction): boolean {
  return isFlowExcluded(t) || (t.ownTransfer && t.choice === null) || t.markedNotSpending === true || t.markedTransfer === true;
}

/**
 * Places what the owner's past choices settle (the owner, 2026-10-10): a merchant's charge with no choice
 * or rule of its own goes where 90% of at least 3 decided charges went, unless it is at least twice the
 * merchant's usual, which is marked and left for the owner. Only the owner's own choices teach it.
 */
function withLearning(transactions: BudgetTransaction[], items: Map<string, PlannedItem>): BudgetTransaction[] {
  const decisions = transactions.flatMap((t) =>
    t.choice && t.amountCents < 0 && !notSpending(t) && placementExists(t.choice, items)
      ? [{ sourceKey: t.sourceKey, placement: t.choice, spentCents: -t.amountCents }]
      : [],
  );
  const learned = learnFromDecisions(decisions);
  return transactions.map((t) => {
    const merchant = learned.get(t.sourceKey);
    if (!merchant?.placement || t.choice || (t.rule && placementExists(t.rule, items))) return t;
    if (t.amountCents < 0 && isLarge(-t.amountCents, merchant)) return { ...t, usualCents: merchant.usualCents };
    return placementExists(merchant.placement, items) ? { ...t, auto: merchant.placement } : t;
  });
}

/** Where a transaction is placed: its own choice, else its merchant's rule, else what was learned. */
export function placementOf(t: BudgetTransaction): Placement | null {
  return t.choice ?? t.rule ?? t.auto ?? null;
}

function isPlaced(t: BudgetTransaction, items: Map<string, PlannedItem>): boolean {
  const placement = placementOf(t);
  return placement !== null && placementExists(placement, items);
}

/**
 * Where a transaction counts, if anywhere, whatever its date. Transfers and card payments never do. Spending goes where
 * its choice or rule says. Money in counts only as a refund: placed by the merchant's rule and not
 * counted as income.
 */
function effectOf(t: BudgetTransaction, items: Map<string, PlannedItem>): Effect[] {
  if (notSpending(t)) return [];
  const placement = placementOf(t);
  if (!placement || !placementExists(placement, items)) return [];
  if (t.amountCents > 0 && t.countedAsIncome) return [];
  return [{ transaction: t, placement, costCents: -t.amountCents, taxCategoryId: categoryOf(placement, items) }];
}

/** Spending since the start date with no choice or rule, or one whose line item is gone, grouped by merchant. */
function miscPile(transactions: BudgetTransaction[], startDate: string, today: string, items: Map<string, PlannedItem>) {
  const loose = transactions.filter((t) => {
    if (t.amountCents >= 0 || t.date < startDate || t.date > today || notSpending(t)) return false;
    return !isPlaced(t, items);
  });
  const misc = groupBySource(loose.map(toMiscTransaction));
  return { misc, miscCount: loose.length };
}

function toMiscTransaction(t: BudgetTransaction): MiscTransaction {
  const { id, date, label, name, sourceKey, amountCents, pending, category, categoryDetail, usualCents } = t;
  return { id, date, label, name, sourceKey, amountCents: -amountCents, pending, category, categoryDetail, usualCents };
}

/** Each item's cost, with a sub-item's also added to its parent. */
function actualByItem(effects: Effect[], items: Map<string, PlannedItem>): Record<string, number> {
  const totals: Record<string, number> = {};
  const add = (id: string, cents: number) => (totals[id] = (totals[id] ?? 0) + cents);
  for (const { placement, costCents } of effects) {
    if (placement.kind !== "planned_item") continue;
    add(placement.plannedItemId, costCents);
    const parentId = items.get(placement.plannedItemId)?.parentId;
    if (parentId) add(parentId, costCents);
  }
  return totals;
}

/** Each item's matched transactions, with a sub-item's also listed under its parent, as actualByItem adds them. */
function matchedByItem(effects: Effect[], items: Map<string, PlannedItem>): Record<string, BudgetTransaction[]> {
  const matched: Record<string, BudgetTransaction[]> = {};
  const add = (id: string, transaction: BudgetTransaction) => (matched[id] ??= []).push(transaction);
  for (const { placement, transaction } of [...effects].sort(newestFirst)) {
    if (placement.kind !== "planned_item") continue;
    add(placement.plannedItemId, transaction);
    const parentId = items.get(placement.plannedItemId)?.parentId;
    if (parentId) add(parentId, transaction);
  }
  return matched;
}

/** Each view compares its own items only (a sub-item shares its parent's frequency); off-plan spending counts in both. */
function inViewOf(placement: Placement, items: Map<string, PlannedItem>, view: PlannedView): boolean {
  if (isOffPlan(placement)) return true;
  return items.get(placement.plannedItemId)?.frequency === view;
}

/** A line item's "For" tags are its own, or its parent's for a sub-item; off-plan spending carries its own. */
function tagsOf(placement: Placement, items: Map<string, PlannedItem>): string[] {
  if (isOffPlan(placement)) return placement.businessId ? [placement.businessId] : [];
  const item = items.get(placement.plannedItemId);
  const parent = item?.parentId ? items.get(item.parentId) : undefined;
  return (parent ?? item)?.businessIds ?? [];
}

function categoryOf(placement: Placement, items: Map<string, PlannedItem>): string | null {
  if (isOffPlan(placement)) return placement.taxCategoryId;
  return items.get(placement.plannedItemId)?.taxCategoryId ?? null;
}

/** Spending on a line item the plan counts: the item is being paid, and so is its parent for a sub-item. */
function isPaying(placement: Placement, items: Map<string, PlannedItem>): boolean {
  if (placement.kind !== "planned_item") return false;
  const item = items.get(placement.plannedItemId);
  const parent = item?.parentId ? items.get(item.parentId) : undefined;
  return item?.status === "active" && (parent === undefined || parent.status === "active");
}

function placementExists(placement: Placement, items: Map<string, PlannedItem>): boolean {
  return isOffPlan(placement) || items.has(placement.plannedItemId);
}

function groupTotals(effects: Effect[], keyOf: (effect: Effect) => string | null): GroupTotal[] {
  const totals = new Map<string | null, number>();
  for (const effect of effects) {
    const key = keyOf(effect);
    totals.set(key, (totals.get(key) ?? 0) + effect.costCents);
  }
  return [...totals.entries()]
    .map(([key, totalCents]) => ({ key, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents || String(a.key).localeCompare(String(b.key)));
}

/** Actuals before anything is known: every figure null. */
export function unknownActuals(): BudgetActuals {
  return {
    period: null,
    actualByItem: {},
    matchedByItem: {},
    outOfBudget: [],
    outOfBudgetCents: null,
    oneTime: [],
    oneTimeCents: null,
    oneTimeByKind: [],
    notSpending: [],
    transfers: [],
    spending: [],
    totalCents: null,
    unsortedCents: null,
    periodSpentCents: null,
    plannedSpentCents: null,
    byCategory: [],
    byLine: [],
    misc: [],
    miscCount: 0,
  };
}

function newestFirst(a: Effect, b: Effect): number {
  return a.transaction.date === b.transaction.date
    ? a.transaction.id.localeCompare(b.transaction.id)
    : a.transaction.date < b.transaction.date
      ? 1
      : -1;
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/** How actual stands against plan: money left, over by an amount, or exactly on the line. */
export type Standing = { kind: "left" | "over" | "even"; cents: number };

export function standing(plannedCents: number, actualCents: number): Standing {
  const diff = plannedCents - actualCents;
  if (diff > 0) return { kind: "left", cents: diff };
  if (diff < 0) return { kind: "over", cents: -diff };
  return { kind: "even", cents: 0 };
}

/** An item's actual in the period: a real $0.00 when nothing matched, null while actuals are unknown. */
export function actualOf(actuals: Pick<BudgetActuals, "period" | "actualByItem">, itemId: string): number | null {
  return actuals.period ? (actuals.actualByItem[itemId] ?? 0) : null;
}
