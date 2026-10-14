// The planned budget's totals: each item's amount, the Monthly and Annual views, and totals by business and tax line.

export type Frequency = "monthly" | "annual";

export type PlannedItem = {
  id: string;
  parentId: string | null;
  name: string;
  amountCents: number;
  frequency: Frequency;
  status: "active" | "not_paying";
  notes: string;
  taxCategoryId: string | null;
  /** "For" tags. Empty means personal. Sub-items are for whatever their parent is for. */
  businessIds: string[];
};

export type PlannedView = "monthly" | "annual";

export type PlannedFilter = { kind: "all" } | { kind: "personal" } | { kind: "business"; businessId: string };

export type PlannedRow = {
  item: PlannedItem;
  /** Per the item's own frequency: its amount, or its active sub-items' total. */
  amountCents: number;
  /** In this view. Each view shows only its own items (the owner, 2026-10-10), so this is amountCents. */
  viewAmountCents: number;
  /** Comes from sub-items, so it cannot be typed over. */
  computed: boolean;
  /** Counts toward totals: active, and for a sub-item its parent is active too. */
  counts: boolean;
  /** Tagged with more than one business, so a business view counts it in full. */
  shared: boolean;
  subItems: PlannedRow[];
};

export type GroupTotal = { key: string | null; totalCents: number };

export type PlannedBudget = {
  rows: PlannedRow[];
  /** Null when the owner has entered nothing at all; a real $0.00 otherwise. */
  totalCents: number | null;
  /** By the owner's tax category; a null key is uncategorised. Biggest first. */
  byCategory: GroupTotal[];
  /** By Schedule C line, through the owner's mapping; a null key is unmapped. Biggest first. */
  byLine: GroupTotal[];
  /** Shared costs counted here in full; only ever above zero in a business view. */
  sharedCount: number;
};

export function plannedBudget(input: {
  items: PlannedItem[];
  view: PlannedView;
  filter: PlannedFilter;
  /** The Schedule C line the owner mapped a tax category to, or null. */
  lineOf: (taxCategoryId: string | null) => string | null;
}): PlannedBudget {
  const { items, view, filter, lineOf } = input;
  const rows = topLevel(items)
    .filter((item) => inView(item, view) && matches(item, filter))
    .map((item) => toRow(item, subItemsOf(items, item.id)));
  const leaves = rows.flatMap(countedLeaves);

  return {
    rows,
    totalCents: items.length === 0 ? null : sum(leaves.map((leaf) => leaf.viewAmountCents)),
    byCategory: groupTotals(leaves, (leaf) => leaf.item.taxCategoryId),
    byLine: groupTotals(leaves, (leaf) => lineOf(leaf.item.taxCategoryId)),
    sharedCount: filter.kind === "business" ? rows.filter((row) => row.counts && row.shared).length : 0,
  };
}

function toRow(item: PlannedItem, children: PlannedItem[]): PlannedRow {
  const subItems = children.map((child) => toSubRow(child, item));
  const computed = subItems.length > 0;
  const amountCents = computed ? sum(subItems.filter(isActive).map((sub) => sub.amountCents)) : item.amountCents;
  return {
    item,
    amountCents,
    viewAmountCents: amountCents,
    computed,
    counts: item.status === "active",
    shared: item.businessIds.length > 1,
    subItems,
  };
}

function toSubRow(sub: PlannedItem, parent: PlannedItem): PlannedRow {
  return {
    item: sub,
    amountCents: sub.amountCents,
    viewAmountCents: sub.amountCents,
    computed: false,
    counts: sub.status === "active" && parent.status === "active",
    shared: parent.businessIds.length > 1,
    subItems: [],
  };
}

/** What adds up: a row's counted sub-items when it has any, else the row itself when it counts. */
function countedLeaves(row: PlannedRow): PlannedRow[] {
  if (row.computed) return row.subItems.filter((sub) => sub.counts);
  return row.counts ? [row] : [];
}

function groupTotals(leaves: PlannedRow[], keyOf: (leaf: PlannedRow) => string | null): GroupTotal[] {
  const totals = new Map<string | null, number>();
  for (const leaf of leaves) {
    const key = keyOf(leaf);
    totals.set(key, (totals.get(key) ?? 0) + leaf.viewAmountCents);
  }
  return [...totals.entries()]
    .map(([key, totalCents]) => ({ key, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents || String(a.key).localeCompare(String(b.key)));
}

/** Monthly shows only the monthly items and Annual only the annual ones; each hides the other. */
function inView(item: PlannedItem, view: PlannedView): boolean {
  return item.frequency === view;
}

/** Whether a set of "For" tags belongs in a view: all, personal (no tags) or one business. */
export function inFilter(businessIds: string[], filter: PlannedFilter): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "personal") return businessIds.length === 0;
  return businessIds.includes(filter.businessId);
}

const matches = (item: PlannedItem, filter: PlannedFilter) => inFilter(item.businessIds, filter);

const topLevel = (items: PlannedItem[]) => items.filter((item) => item.parentId === null);

const subItemsOf = (items: PlannedItem[], parentId: string) => items.filter((item) => item.parentId === parentId);

const isActive = (row: PlannedRow) => row.item.status === "active";

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/** Every line item to pick from, a sub-item after its parent as "Parent › Sub-item". */
export function itemChoices(items: PlannedItem[]): { id: string; label: string }[] {
  return topLevel(items).flatMap((item) => [
    { id: item.id, label: item.name },
    ...subItemsOf(items, item.id).map((sub) => ({ id: sub.id, label: `${item.name} › ${sub.name}` })),
  ]);
}
