// Read queries behind the planned budget tabs: items, tax categories, Schedule C lines and the spending checked against them.
import type { BudgetTransaction, Placement } from "@/lib/actuals";
import { DEPOSIT_STATUS_SQL, FLOW_EXCLUSION_SQL, SORTING_JOINS_SQL, ownTransferSql } from "@/lib/flow";
import type { PlannedItem } from "@/lib/planned-budget";
import type { SpendingRule } from "@/lib/sorting";
import type { ScheduleCForm, TaxCategory } from "@/lib/tax-categories";
import type { Queryable } from "@/server/db";
import { DAY, cents } from "./repository";

/** Every planned item of the owner with its "For" tags, oldest first. */
export async function readPlannedItems(tx: Queryable, ownerId: string): Promise<PlannedItem[]> {
  const r = await tx.query<{
    id: string;
    parent_id: string | null;
    name: string;
    amount_cents: string;
    frequency: PlannedItem["frequency"];
    status: PlannedItem["status"];
    notes: string;
    tax_category_id: string | null;
    business_ids: string[];
  }>(
    `SELECT i.id, i.parent_id, i.name, i.amount_cents, i.frequency, i.status, i.notes, i.tax_category_id,
            COALESCE(array_agg(t.business_id::text ORDER BY t.business_id) FILTER (WHERE t.business_id IS NOT NULL), '{}') AS business_ids
       FROM planned_items i
       LEFT JOIN planned_item_businesses t ON t.owner_id = i.owner_id AND t.item_id = i.id
      WHERE i.owner_id = $1
      GROUP BY i.id
      ORDER BY i.created_at, i.id`,
    [ownerId],
  );
  return r.rows.flatMap((row) => {
    const amountCents = cents(row.amount_cents);
    if (amountCents === null) return [];
    return [{
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      amountCents,
      frequency: row.frequency,
      status: row.status,
      notes: row.notes,
      taxCategoryId: row.tax_category_id,
      businessIds: row.business_ids,
    }];
  });
}

/** The owner's tax categories, each with the Schedule C line it maps to, by name. */
export async function readTaxCategories(tx: Queryable, ownerId: string): Promise<TaxCategory[]> {
  const r = await tx.query<{
    id: string;
    name: string;
    schedule_c_year: number | null;
    schedule_c_line: string | null;
    personal: boolean;
    mapping_confirmed: boolean;
    heading: string | null;
    label: string | null;
  }>(
    `SELECT c.id, c.name, c.schedule_c_year, c.schedule_c_line, c.personal, c.mapping_confirmed, l.heading, l.label
       FROM tax_categories c
       LEFT JOIN reference.schedule_c_lines l ON l.tax_year = c.schedule_c_year AND l.line = c.schedule_c_line
      WHERE c.owner_id = $1
      ORDER BY lower(c.name), c.id`,
    [ownerId],
  );
  return r.rows.map((row) => {
    const line =
      row.schedule_c_year !== null && row.schedule_c_line !== null && row.label !== null
        ? { year: row.schedule_c_year, line: row.schedule_c_line, heading: row.heading, label: row.label }
        : null;
    return {
      id: row.id,
      name: row.name,
      mapping: line ? { kind: "line", year: line.year, line: line.line } : { kind: row.personal ? "personal" : "unmapped" },
      confirmed: row.mapping_confirmed,
      line,
    };
  });
}

/** The newest tax year's Schedule C expense lines, in form order, with their source; null with none. */
export async function readScheduleCForm(tx: Queryable): Promise<ScheduleCForm | null> {
  const r = await tx.query<{
    tax_year: number;
    line: string;
    heading: string | null;
    label: string;
    source_url: string;
    checked_on: string;
  }>(
    `SELECT tax_year, line, heading, label, source_url, to_char(checked_on, 'YYYY-MM-DD') AS checked_on
       FROM reference.schedule_c_lines
      WHERE tax_year = (SELECT max(tax_year) FROM reference.schedule_c_lines)
      ORDER BY position`,
  );
  const first = r.rows[0];
  if (!first) return null;
  return {
    year: first.tax_year,
    sourceUrl: first.source_url,
    checkedOn: first.checked_on,
    lines: r.rows.map((row) => ({ year: row.tax_year, line: row.line, heading: row.heading, label: row.label })),
  };
}

/** The first day budget checking covers, or null before it is set. */
export async function readBudgetStart(tx: Queryable, ownerId: string): Promise<string | null> {
  const r = await tx.query<{ start: string }>(
    `SELECT to_char(start_date, '${DAY}') AS start FROM budget_settings WHERE owner_id = $1`,
    [ownerId],
  );
  return r.rows[0]?.start ?? null;
}

/** Whether any transaction has synced: until one has, every actual is unknown. */
export async function readHasTransactions(tx: Queryable, ownerId: string): Promise<boolean> {
  const r = await tx.query("SELECT 1 FROM transactions WHERE owner_id = $1 AND removed_at IS NULL LIMIT 1", [ownerId]);
  return r.rows.length > 0;
}

type PlacementColumns = {
  kind: string | null;
  item: string | null;
  business: string | null;
  category: string | null;
  oneTimeKind: string | null;
};

/**
 * Every non-removed transaction from `since` on, with its budget choice and its merchant's spending
 * rule. Which ones count is decided in lib/actuals.ts, not here.
 */
export async function readBudgetTransactions(tx: Queryable, ownerId: string, since: string): Promise<BudgetTransaction[]> {
  const r = await tx.query<{
    id: string;
    date: string;
    label: string;
    name: string;
    source_key: string;
    amount_cents: string;
    pending: boolean;
    category: string | null;
    category_detail: string | null;
    counted_as_income: boolean;
    own_transfer: boolean;
    marked_not_spending: boolean;
    marked_transfer: boolean;
    choice_kind: string | null;
    choice_item: string | null;
    choice_business: string | null;
    choice_category: string | null;
    choice_one_time_kind: string | null;
    rule_kind: string | null;
    rule_item: string | null;
    rule_business: string | null;
    rule_category: string | null;
    rule_one_time_kind: string | null;
  }>(
    `SELECT t.id, to_char(t.date, '${DAY}') AS date, COALESCE(t.merchant, t.name) AS label, t.name, t.source_key,
            t.amount_cents, t.pending, t.category, t.category_detail,
            ${DEPOSIT_STATUS_SQL} = 'income' AS counted_as_income,
            ${ownTransferSql("t")} AS own_transfer,
            COALESCE(c.kind = 'not_spending', false) AS marked_not_spending,
            t.amount_cents < 0 AND (c.kind = 'transfer' OR (c.transaction_id IS NULL AND s.kind = 'transfer')) AS marked_transfer,
            CASE WHEN c.kind IN ('planned_item', 'out_of_budget', 'one_time') THEN c.kind END AS choice_kind,
            c.planned_item_id AS choice_item, c.business_id AS choice_business, c.tax_category_id AS choice_category,
            c.one_time_kind_id AS choice_one_time_kind,
            s.kind AS rule_kind, s.planned_item_id AS rule_item, s.business_id AS rule_business,
            s.tax_category_id AS rule_category, s.one_time_kind_id AS rule_one_time_kind
       FROM transactions t ${SORTING_JOINS_SQL}
       LEFT JOIN transaction_rules s ON s.owner_id = t.owner_id AND s.scope = 'spending' AND s.source_key = t.source_key
      WHERE t.owner_id = $1 AND t.removed_at IS NULL AND t.date >= $2::date
      ORDER BY t.date DESC, t.created_at DESC, t.id DESC`,
    [ownerId, since],
  );
  return r.rows.flatMap((row) => {
    const amountCents = cents(row.amount_cents);
    if (amountCents === null) return [];
    return [{
      id: row.id,
      date: row.date,
      label: row.label,
      name: row.name,
      sourceKey: row.source_key,
      amountCents,
      pending: row.pending,
      category: row.category,
      categoryDetail: row.category_detail,
      countedAsIncome: row.counted_as_income,
      ownTransfer: row.own_transfer,
      markedNotSpending: row.marked_not_spending,
      markedTransfer: row.marked_transfer,
      choice: toPlacement({
        kind: row.choice_kind,
        item: row.choice_item,
        business: row.choice_business,
        category: row.choice_category,
        oneTimeKind: row.choice_one_time_kind,
      }),
      rule: toPlacement({
        kind: row.rule_kind,
        item: row.rule_item,
        business: row.rule_business,
        category: row.rule_category,
        oneTimeKind: row.rule_one_time_kind,
      }),
    }];
  });
}

function toPlacement(columns: PlacementColumns): Placement | null {
  if (columns.kind === "planned_item" && columns.item) return { kind: "planned_item", plannedItemId: columns.item };
  if (columns.kind === "out_of_budget") {
    return { kind: "out_of_budget", businessId: columns.business, taxCategoryId: columns.category };
  }
  if (columns.kind === "one_time") {
    return { kind: "one_time", businessId: columns.business, taxCategoryId: columns.category, oneTimeKindId: columns.oneTimeKind };
  }
  return null;
}

/**
 * The owner's spending rules, each described in words, by merchant. A rule's count is the charges it
 * sorts: from the budget start date on, never a transfer or card payment (none before a start date).
 */
export async function readSpendingRules(tx: Queryable, ownerId: string): Promise<SpendingRule[]> {
  const r = await tx.query<{
    id: string;
    source_key: string;
    kind: string;
    item_name: string | null;
    business_name: string | null;
    kind_name: string | null;
    label: string | null;
    spending_count: string;
  }>(
    `SELECT r.id, r.source_key, r.kind, i.name AS item_name, b.name AS business_name, k.name AS kind_name, s.label, s.spending_count
       FROM transaction_rules r
       LEFT JOIN planned_items i ON i.owner_id = r.owner_id AND i.id = r.planned_item_id
       LEFT JOIN businesses b ON b.owner_id = r.owner_id AND b.id = r.business_id
       LEFT JOIN one_time_kinds k ON k.owner_id = r.owner_id AND k.id = r.one_time_kind_id
       LEFT JOIN budget_settings bs ON bs.owner_id = r.owner_id
       LEFT JOIN LATERAL (
         SELECT (array_agg(COALESCE(t.merchant, t.name) ORDER BY t.date DESC, t.id DESC))[1] AS label,
                count(*) FILTER (WHERE t.date >= bs.start_date AND NOT ${FLOW_EXCLUSION_SQL}) AS spending_count
           FROM transactions t
          WHERE t.owner_id = r.owner_id AND t.source_key = r.source_key
            AND t.removed_at IS NULL AND t.amount_cents < 0
       ) s ON true
      WHERE r.owner_id = $1 AND r.scope = 'spending'
      ORDER BY lower(COALESCE(s.label, r.source_key)), r.id`,
    [ownerId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    sourceKey: row.source_key,
    label: row.label ?? row.source_key,
    target: ruleTargetWords(row.kind, row.item_name, row.business_name, row.kind_name),
    spendingCount: Number(row.spending_count),
  }));
}

/** Where a spending rule sends a merchant, in words. */
function ruleTargetWords(kind: string, itemName: string | null, businessName: string | null, kindName: string | null): string {
  if (kind === "planned_item") return itemName ?? "A line item";
  if (kind === "transfer") return "Transfer between my accounts";
  if (kind === "one_time") return offPlanWords(kindName ? `One-time · ${kindName}` : "One-time", businessName);
  return offPlanWords("Out of budget", businessName);
}

function offPlanWords(place: string, businessName: string | null): string {
  return businessName ? `${place}, for ${businessName}` : place;
}
