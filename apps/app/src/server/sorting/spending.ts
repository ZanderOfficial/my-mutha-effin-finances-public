// Matching spending to the planned budget: to a planned item, out of budget or one-time, for a merchant or a few transactions.
import type { Queryable } from "@/server/db";
import { isUuid, parseIdList, parseOptionalId } from "@/server/form-values";
import { insertItem, missingReference, parseNewItem, type NewItemInput } from "@/server/planned/planned";
import { OK, fail, type Run, type WriteResult } from "@/server/write-result";

const MAX_SOURCE_KEY = 200;
const MAX_CHOICES = 500;

/**
 * Where spending goes: a planned item (or sub-item), or off the plan (out of budget or one-time) with an
 * optional "For" tag and tax category. A tag the form left out is kept from where the spending sits now.
 */
export type Target =
  | { kind: "planned_item"; plannedItemId: string }
  | { kind: "not_spending" }
  | { kind: "transfer" }
  | TaggedTarget;

type TaggedTarget = {
  kind: "out_of_budget" | "one_time";
  businessId: string | null;
  taxCategoryId: string | null;
  /** What a one-time purchase was, from the owner's own list; always null for out of budget. */
  oneTimeKindId: string | null;
  keepBusiness: boolean;
  keepTaxCategory: boolean;
  keepOneTimeKind: boolean;
};

/** The off-plan kinds a form names: "out" for out of budget, "one" for one-time. */
const TAGGED_KINDS: Record<string, TaggedTarget["kind"]> = { out: "out_of_budget", one: "one_time" };

/** The "For" tag, tax category and one-time kind written with a match. */
type Tags = { businessId: string | null; taxCategoryId: string | null; oneTimeKindId: string | null };

const NO_TAGS: Tags = { businessId: null, taxCategoryId: null, oneTimeKindId: null };

/** A one-time kind the form leaves out (undefined or null) is kept, like the other tags. */
export type TargetInput = { target: unknown; businessId: unknown; taxCategoryId: unknown; oneTimeKindId?: unknown };

/**
 * What a match covers: every transaction from the merchant, now and later, or only the ones picked.
 * `each` sends single charges somewhere else in the same save (the owner, 2026-10-10): with Always on
 * they are the exceptions to the new rule, since a transaction's own choice beats its merchant's rule.
 */
export type Scope = { sourceKey: unknown; always: boolean; transactionIds: unknown[]; each?: EachInput[] };

/** One charge sent to its own place: a line item's id, or "out" or "one" for out of budget or one-time (keeping its tags). */
export type EachInput = { transactionId: unknown; target: unknown };

/** Matches a merchant's spending, or the picked transactions, to a planned item or out of budget. */
export async function matchSpending(run: Run, ownerId: string, input: Scope & TargetInput): Promise<WriteResult> {
  const target = parseTarget(input);
  if (typeof target === "string") return fail(target);
  const scope = parseScope(input);
  if (typeof scope === "string") return fail(scope);
  if (scope.always && target.kind === "not_spending") return fail("Not spending is for single charges, not a whole merchant.");
  const each = parseEach(input.each);
  if (typeof each === "string") return fail(each);

  return run(ownerId, async (tx) => {
    const missing = (await missingTarget(tx, target)) ?? (await missingSpending(tx, scope)) ?? (await missingEach(tx, each));
    if (missing) return fail(missing);
    await writeMatch(tx, ownerId, scope, target);
    await writeEach(tx, ownerId, each);
    return OK;
  });
}

/** Makes a new planned item from a merchant and matches the merchant's spending to it, in one transaction. */
export async function makeItemFromSpending(
  run: Run,
  ownerId: string,
  input: Scope & NewItemInput,
): Promise<WriteResult> {
  const item = parseNewItem(input);
  if (!item.ok) return item;
  const scope = parseScope(input);
  if (typeof scope === "string") return fail(scope);
  const each = parseEach(input.each);
  if (typeof each === "string") return fail(each);

  return run(ownerId, async (tx) => {
    // Check the spending before inserting, since a refusal does not roll the item back.
    const missing = (await missingSpending(tx, scope)) ?? (await missingEach(tx, each));
    if (missing) return fail(missing);
    const created = await insertItem(tx, ownerId, item.value);
    if (!created.ok) return created;
    await writeMatch(tx, ownerId, scope, { kind: "planned_item", plannedItemId: created.value });
    await writeEach(tx, ownerId, each);
    return OK;
  });
}

/** Sends single charges each to its own place, with no choice for the merchant as a whole. */
export async function sortCharges(run: Run, ownerId: string, picks: EachInput[]): Promise<WriteResult> {
  const each = parseEach(picks);
  if (typeof each === "string") return fail(each);
  if (each.length === 0) return fail("Choose where at least one charge goes.");

  return run(ownerId, async (tx) => {
    const missing = await missingEach(tx, each);
    if (missing) return fail(missing);
    await writeEach(tx, ownerId, each);
    return OK;
  });
}

// Input checks. Form values arrive as unknown, so each one is narrowed before use.

/** The form's "target" is a planned item's id, "out" for out of budget or "one" for one-time. */
function parseTarget(input: TargetInput): Target | string {
  if (input.target === "not_spending") return { kind: "not_spending" };
  if (input.target === "transfer") return { kind: "transfer" };
  const tagged = typeof input.target === "string" ? TAGGED_KINDS[input.target] : undefined;
  if (tagged) {
    const businessId = parseOptionalId(input.businessId);
    const taxCategoryId = parseOptionalId(input.taxCategoryId);
    const oneTimeKindId = tagged === "one_time" ? parseOptionalId(input.oneTimeKindId) : null;
    if (businessId === undefined) return "That business is not valid.";
    if (taxCategoryId === undefined) return "That tax category is not valid.";
    if (oneTimeKindId === undefined) return "That one-time kind is not valid.";
    return {
      kind: tagged,
      businessId,
      taxCategoryId,
      oneTimeKindId,
      keepBusiness: isAbsent(input.businessId),
      keepTaxCategory: isAbsent(input.taxCategoryId),
      keepOneTimeKind: tagged === "one_time" && isAbsent(input.oneTimeKindId),
    };
  }
  return isUuid(input.target) ? { kind: "planned_item", plannedItemId: input.target } : "Choose a line item, out of budget or one-time.";
}

/** A field the form did not send at all (FormData.get gives null), as opposed to "" for None. */
function isAbsent(value: unknown): boolean {
  return value === null || value === undefined;
}

type CheckedScope = { always: true; sourceKey: string } | { always: false; transactionIds: string[] };

function parseScope(input: Scope): CheckedScope | string {
  if (input.always) {
    const { sourceKey } = input;
    if (typeof sourceKey !== "string" || sourceKey.length === 0 || sourceKey.length > MAX_SOURCE_KEY) return "That merchant is not valid.";
    return { always: true, sourceKey };
  }
  const ids = parseIdList(input.transactionIds);
  if (ids === undefined) return "That transaction is not valid.";
  // Every charge may have gone somewhere of its own, leaving none for the merchant's choice.
  if (ids.length === 0 && (input.each?.length ?? 0) > 0) return { always: false, transactionIds: [] };
  if (ids.length === 0) return "Tick at least one transaction.";
  if (ids.length > MAX_CHOICES) return `Sort at most ${MAX_CHOICES} transactions at a time.`;
  return { always: false, transactionIds: ids };
}

/** Single charges, grouped by where each goes, so each group is checked and written once. */
type EachGroup = { target: Target; transactionIds: string[] };

function parseEach(input: EachInput[] | undefined): EachGroup[] | string {
  const groups = new Map<string, EachGroup>();
  for (const pick of input ?? []) {
    const target = parseTarget({ target: pick.target, businessId: null, taxCategoryId: null, oneTimeKindId: null });
    if (typeof target === "string") return target;
    if (!isUuid(pick.transactionId)) return "That transaction is not valid.";
    const key = target.kind === "planned_item" ? target.plannedItemId : target.kind;
    const group = groups.get(key) ?? { target, transactionIds: [] };
    group.transactionIds.push(pick.transactionId);
    groups.set(key, group);
  }
  const count = [...groups.values()].reduce((total, group) => total + group.transactionIds.length, 0);
  return count > MAX_CHOICES ? `Sort at most ${MAX_CHOICES} transactions at a time.` : [...groups.values()];
}

// Writes and existence checks, run under the owner's RLS scope, so another owner's rows are never found.

/** Says why one of the single charges, or where it goes, cannot be used, or null when all can. */
async function missingEach(tx: Queryable, groups: EachGroup[]): Promise<string | null> {
  for (const group of groups) {
    const missing = (await missingTarget(tx, group.target)) ?? (await missingSpending(tx, { always: false, transactionIds: group.transactionIds }));
    if (missing) return missing;
  }
  return null;
}

/** Writes each single charge's own choice. Checked first by missingEach. */
async function writeEach(tx: Queryable, ownerId: string, groups: EachGroup[]): Promise<void> {
  for (const group of groups) await writeMatch(tx, ownerId, { always: false, transactionIds: group.transactionIds }, group.target);
}

/** Says why the merchant or the picked transactions cannot be matched, or null when they can. */
async function missingSpending(tx: Queryable, scope: CheckedScope): Promise<string | null> {
  if (scope.always) return (await hasSpending(tx, scope.sourceKey)) ? null : "No spending comes from that merchant.";
  if (scope.transactionIds.length === 0) return null;
  const owned = await countSpending(tx, scope.transactionIds);
  return owned === scope.transactionIds.length ? null : "Only your own spending can be matched to the budget.";
}

/** Writes a rule for the merchant, or a choice for each picked transaction. Checked first by missingSpending. */
async function writeMatch(tx: Queryable, ownerId: string, scope: CheckedScope, target: Target): Promise<void> {
  const plannedItemId = target.kind === "planned_item" ? target.plannedItemId : null;
  if (!scope.always && scope.transactionIds.length === 0) return;

  if (scope.always) {
    const [tags] = await tagsFor(tx, target, await currentRulePlacement(tx, scope.sourceKey));
    await tx.query(
      `INSERT INTO transaction_rules (owner_id, scope, source_key, kind, planned_item_id, business_id, tax_category_id, one_time_kind_id)
       VALUES ($1, 'spending', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (owner_id, scope, source_key) DO UPDATE SET
         kind = EXCLUDED.kind, planned_item_id = EXCLUDED.planned_item_id, business_id = EXCLUDED.business_id,
         tax_category_id = EXCLUDED.tax_category_id, one_time_kind_id = EXCLUDED.one_time_kind_id, updated_at = now()`,
      [ownerId, scope.sourceKey, target.kind, plannedItemId, tags.businessId, tags.taxCategoryId, tags.oneTimeKindId],
    );
    return;
  }

  const current = await currentChoicePlacements(tx, scope.transactionIds);
  const tags = await tagsFor(tx, target, current);
  await tx.query(
    `INSERT INTO transaction_choices (owner_id, transaction_id, kind, planned_item_id, business_id, tax_category_id, one_time_kind_id)
     SELECT $1, x.id, $3, $4, x.business_id, x.tax_category_id, x.one_time_kind_id
       FROM unnest($2::uuid[], $5::uuid[], $6::uuid[], $7::uuid[]) AS x(id, business_id, tax_category_id, one_time_kind_id)
     ON CONFLICT (transaction_id) DO UPDATE SET
       kind = EXCLUDED.kind, planned_item_id = EXCLUDED.planned_item_id, business_id = EXCLUDED.business_id,
       tax_category_id = EXCLUDED.tax_category_id, one_time_kind_id = EXCLUDED.one_time_kind_id, updated_at = now()`,
    [
      ownerId,
      current.map((row) => row.id),
      target.kind,
      plannedItemId,
      tags.map((tag) => tag.businessId),
      tags.map((tag) => tag.taxCategoryId),
      tags.map((tag) => tag.oneTimeKindId),
    ],
  );
}

// Keeping tags. Moving spending off the plan without naming a tag keeps the one it has now,
// so a charge never drops off its business tab or out of the tax totals by being moved.

/** Where one transaction (or a merchant) sits in the budget now; kind is null when unsorted. */
type CurrentPlacement = {
  id: string;
  kind: string | null;
  item: string | null;
  business: string | null;
  category: string | null;
  one_time_kind: string | null;
};

/** The tags each placement is written with, in the same order. */
async function tagsFor(tx: Queryable, target: Target, current: CurrentPlacement[]): Promise<Tags[]> {
  if (target.kind !== "out_of_budget" && target.kind !== "one_time") return current.map(() => NO_TAGS);
  const named = { businessId: target.businessId, taxCategoryId: target.taxCategoryId, oneTimeKindId: target.oneTimeKindId };
  if (!target.keepBusiness && !target.keepTaxCategory && !target.keepOneTimeKind) return current.map(() => named);

  const itemTags = await readItemTags(tx, current.flatMap((row) => (row.item ? [row.item] : [])));
  return current.map((row) => {
    const kept = keptTags(row, itemTags);
    return {
      businessId: target.keepBusiness ? kept.businessId : named.businessId,
      taxCategoryId: target.keepTaxCategory ? kept.taxCategoryId : named.taxCategoryId,
      oneTimeKindId: target.keepOneTimeKind ? kept.oneTimeKindId : named.oneTimeKindId,
    };
  });
}

/** An off-plan placement keeps its own tags (a one-time kind only from one-time); a line item's spending takes the item's. */
function keptTags(current: CurrentPlacement, itemTags: Map<string, Tags>): Tags {
  if (current.kind === "out_of_budget" || current.kind === "one_time") {
    const oneTimeKindId = current.kind === "one_time" ? current.one_time_kind : null;
    return { businessId: current.business, taxCategoryId: current.category, oneTimeKindId };
  }
  if (current.kind === "planned_item" && current.item) return itemTags.get(current.item) ?? NO_TAGS;
  return NO_TAGS;
}

/** Each picked transaction's placement now: its own budget choice, else its merchant's spending rule. */
async function currentChoicePlacements(tx: Queryable, ids: string[]): Promise<CurrentPlacement[]> {
  const r = await tx.query<CurrentPlacement>(
    `SELECT t.id,
            CASE WHEN c.kind IS NOT NULL THEN c.kind ELSE s.kind END AS kind,
            CASE WHEN c.kind IS NOT NULL THEN c.planned_item_id ELSE s.planned_item_id END AS item,
            CASE WHEN c.kind IS NOT NULL THEN c.business_id ELSE s.business_id END AS business,
            CASE WHEN c.kind IS NOT NULL THEN c.tax_category_id ELSE s.tax_category_id END AS category,
            CASE WHEN c.kind IS NOT NULL THEN c.one_time_kind_id ELSE s.one_time_kind_id END AS one_time_kind
       FROM transactions t
       LEFT JOIN transaction_choices c
         ON c.owner_id = t.owner_id AND c.transaction_id = t.id AND c.kind IN ('planned_item', 'out_of_budget', 'one_time')
       LEFT JOIN transaction_rules s ON s.owner_id = t.owner_id AND s.scope = 'spending' AND s.source_key = t.source_key
      WHERE t.id = ANY($1::uuid[])
      ORDER BY t.id`,
    [ids],
  );
  return r.rows;
}

/** The merchant's spending rule now, as one placement (unsorted when it has none). */
async function currentRulePlacement(tx: Queryable, sourceKey: string): Promise<CurrentPlacement[]> {
  const r = await tx.query<CurrentPlacement>(
    `SELECT id, kind, planned_item_id AS item, business_id AS business, tax_category_id AS category,
            one_time_kind_id AS one_time_kind
       FROM transaction_rules WHERE scope = 'spending' AND source_key = $1`,
    [sourceKey],
  );
  return r.rows.length > 0 ? r.rows : [{ id: sourceKey, kind: null, item: null, business: null, category: null, one_time_kind: null }];
}

/**
 * Each line item's tax category and "For" tag, the tag read from the parent for a sub-item.
 * Out of budget carries one business, so an item for several businesses (or none) passes on none.
 */
async function readItemTags(tx: Queryable, itemIds: string[]): Promise<Map<string, Tags>> {
  if (itemIds.length === 0) return new Map();
  const r = await tx.query<{ id: string; tax_category_id: string | null; business_ids: string[] }>(
    `SELECT i.id, i.tax_category_id,
            ARRAY(SELECT b.business_id::text FROM planned_item_businesses b
                   WHERE b.owner_id = i.owner_id AND b.item_id = COALESCE(i.parent_id, i.id)) AS business_ids
       FROM planned_items i
      WHERE i.id = ANY($1::uuid[])`,
    [[...new Set(itemIds)]],
  );
  return new Map(r.rows.map((row) => [row.id, itemTagsOf(row)]));
}

function itemTagsOf(row: { tax_category_id: string | null; business_ids: string[] }): Tags {
  return { taxCategoryId: row.tax_category_id, businessId: row.business_ids.length === 1 ? row.business_ids[0] : null, oneTimeKindId: null };
}

async function missingTarget(tx: Queryable, target: Target): Promise<string | null> {
  if (target.kind === "not_spending" || target.kind === "transfer") return null;
  if (target.kind !== "planned_item") {
    const missing = await missingReference(tx, target.taxCategoryId, target.businessId ? [target.businessId] : []);
    return missing ?? (await missingOneTimeKind(tx, target.oneTimeKindId));
  }
  const r = await tx.query("SELECT 1 FROM planned_items WHERE id = $1", [target.plannedItemId]);
  return r.rows.length > 0 ? null : "That line item does not exist.";
}

async function hasSpending(tx: Queryable, sourceKey: string): Promise<boolean> {
  const r = await tx.query("SELECT 1 FROM transactions WHERE source_key = $1 AND amount_cents < 0 LIMIT 1", [sourceKey]);
  return r.rows.length > 0;
}

/** How many of these ids are the owner's own spending (money out). */
async function countSpending(tx: Queryable, ids: string[]): Promise<number> {
  const r = await tx.query<{ n: string }>(
    "SELECT count(*) AS n FROM transactions WHERE id = ANY($1::uuid[]) AND amount_cents < 0",
    [ids],
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function missingOneTimeKind(tx: Queryable, kindId: string | null): Promise<string | null> {
  if (kindId === null) return null;
  const r = await tx.query("SELECT 1 FROM one_time_kinds WHERE id = $1", [kindId]);
  return r.rows.length > 0 ? null : "That one-time kind does not exist.";
}
