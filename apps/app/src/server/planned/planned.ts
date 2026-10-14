// The owner's planned budget writes: items, sub-items, their "For" tags and their status.
import { MAX_LIMIT_CENTS, parseDollarsToCents } from "@/lib/money-input";
import type { Queryable } from "@/server/db";
import { isUuid, parseIdList, parseName, parseOptionalId } from "@/server/form-values";
import { OK, fail, type Run, type WriteResult } from "@/server/write-result";

const FREQUENCIES = new Set(["monthly", "annual"]);
const STATUSES = new Set(["active", "not_paying"]);
const MAX_ITEM_NAME = 120;
const MAX_NOTES = 500;

type Frequency = "monthly" | "annual";
export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
type Common = { name: string; notes: string; taxCategoryId: string | null };
type CommonInput = { name: unknown; notes: unknown; taxCategoryId: unknown };

/** What a write needs to know about an existing item. */
type StoredItem = { parentId: string | null; frequency: Frequency; taxCategoryId: string | null; subItemCount: number };

export type NewItemInput = CommonInput & { amount: unknown; frequency: unknown; businessIds: unknown[] };

/** A checked new top-level item, ready to insert. */
export type NewItem = Common & { amountCents: number; frequency: Frequency; businessIds: string[] };

/** Adds a top-level item, tagged with the businesses it serves (none means personal). */
export async function createItem(run: Run, ownerId: string, input: NewItemInput): Promise<WriteResult> {
  const item = parseNewItem(input);
  if (!item.ok) return item;
  return run(ownerId, async (tx) => {
    const created = await insertItem(tx, ownerId, item.value);
    return created.ok ? OK : created;
  });
}

export function parseNewItem(input: NewItemInput): Parsed<NewItem> {
  const common = parseCommon(input);
  if (!common.ok) return common;
  const amount = parseAmount(input.amount);
  if (!amount.ok) return amount;
  if (!isFrequency(input.frequency)) return { ok: false, message: "Choose monthly or annual." };
  const businessIds = parseIdList(input.businessIds);
  if (businessIds === undefined) return { ok: false, message: "That business is not valid." };
  return { ok: true, value: { ...common.value, amountCents: amount.value, frequency: input.frequency, businessIds } };
}

/** Inserts a checked item inside the caller's transaction and returns its id. */
export async function insertItem(tx: Queryable, ownerId: string, item: NewItem): Promise<Parsed<string>> {
  const missing = await missingReference(tx, item.taxCategoryId, item.businessIds);
  if (missing) return { ok: false, message: missing };

  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO planned_items (owner_id, name, amount_cents, frequency, notes, tax_category_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [ownerId, item.name, item.amountCents, item.frequency, item.notes, item.taxCategoryId],
  );
  const id = inserted.rows[0].id;
  await replaceTags(tx, ownerId, id, item.businessIds);
  return { ok: true, value: id };
}

/** Adds a sub-item. It takes its parent's frequency, and its parent's tax category when the form sends none. */
export async function addSubItem(
  run: Run,
  ownerId: string,
  input: CommonInput & { parentId: unknown; amount: unknown },
): Promise<WriteResult> {
  if (!isUuid(input.parentId)) return fail("That item is not valid.");
  const parentId = input.parentId;
  const common = parseCommon(input);
  if (!common.ok) return common;
  const amount = parseAmount(input.amount);
  if (!amount.ok) return amount;

  return run(ownerId, async (tx) => {
    const parent = await loadItem(tx, parentId);
    if (!parent) return fail("That item does not exist.");
    if (parent.parentId) return fail("A sub-item cannot have sub-items.");
    // Only a form that leaves the field out inherits; "" is the owner choosing None.
    const inherits = input.taxCategoryId === null || input.taxCategoryId === undefined;
    const taxCategoryId = inherits ? parent.taxCategoryId : common.value.taxCategoryId;
    const missing = await missingReference(tx, taxCategoryId, []);
    if (missing) return fail(missing);

    await tx.query(
      `INSERT INTO planned_items (owner_id, parent_id, name, amount_cents, frequency, notes, tax_category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ownerId, parentId, common.value.name, amount.value, parent.frequency, common.value.notes, taxCategoryId],
    );
    return OK;
  });
}

/**
 * Saves one row as the owner edited it. An item with sub-items keeps its stored amount, since its
 * total is theirs; a sub-item keeps its parent's frequency and "For" tags.
 */
export async function updateItem(
  run: Run,
  ownerId: string,
  input: CommonInput & { itemId: unknown; amount: unknown; frequency: unknown; businessIds: unknown[] },
): Promise<WriteResult> {
  if (!isUuid(input.itemId)) return fail("That item is not valid.");
  const itemId = input.itemId;
  const common = parseCommon(input);
  if (!common.ok) return common;
  const businessIds = parseIdList(input.businessIds);
  if (businessIds === undefined) return fail("That business is not valid.");

  return run(ownerId, async (tx) => {
    const item = await loadItem(tx, itemId);
    if (!item) return fail("That item does not exist.");
    const amount = amountFor(item, input.amount);
    if (!amount.ok) return amount;
    const frequency = frequencyFor(item, input.frequency, businessIds);
    if (!frequency.ok) return frequency;
    const missing = await missingReference(tx, common.value.taxCategoryId, businessIds);
    if (missing) return fail(missing);

    await tx.query(
      `UPDATE planned_items
          SET name = $3, amount_cents = COALESCE($4, amount_cents), frequency = $5, notes = $6,
              tax_category_id = $7, updated_at = now()
        WHERE owner_id = $1 AND id = $2`,
      [ownerId, itemId, common.value.name, amount.value, frequency.value, common.value.notes, common.value.taxCategoryId],
    );
    if (!item.parentId) await replaceTags(tx, ownerId, itemId, businessIds);
    return OK;
  });
}

/** "Not currently paying" keeps the row but leaves it out of every total. */
export async function setItemStatus(
  run: Run,
  ownerId: string,
  input: { itemId: unknown; status: unknown },
): Promise<WriteResult> {
  const { itemId, status } = input;
  if (!isUuid(itemId)) return fail("That item is not valid.");
  if (typeof status !== "string" || !STATUSES.has(status)) return fail("Choose paying or not currently paying.");

  return run(ownerId, async (tx) => {
    const updated = await tx.query(
      `UPDATE planned_items SET status = $3, updated_at = now() WHERE owner_id = $1 AND id = $2 RETURNING id`,
      [ownerId, itemId, status],
    );
    return updated.rows.length > 0 ? OK : fail("That item does not exist.");
  });
}

/** Deletes an item. One with sub-items needs `withSubItems` = "1", and then they go with it. */
export async function deleteItem(
  run: Run,
  ownerId: string,
  input: { itemId: unknown; withSubItems: unknown },
): Promise<WriteResult> {
  const { itemId } = input;
  if (!isUuid(itemId)) return fail("That item is not valid.");

  return run(ownerId, async (tx) => {
    const item = await loadItem(tx, itemId);
    if (!item) return fail("That item does not exist.");
    if (item.subItemCount > 0 && input.withSubItems !== "1") {
      const count = item.subItemCount === 1 ? "its sub-item" : `its ${item.subItemCount} sub-items`;
      return fail(`Deleting this item also deletes ${count}. Confirm to go ahead.`);
    }
    await tx.query("DELETE FROM planned_items WHERE owner_id = $1 AND id = $2", [ownerId, itemId]);
    return OK;
  });
}

// Input checks. Form values arrive as unknown, so each one is narrowed before use.

function parseCommon(input: CommonInput): Parsed<Common> {
  const name = parseName(input.name, MAX_ITEM_NAME);
  if (!name) return { ok: false, message: `Enter a name of up to ${MAX_ITEM_NAME} characters.` };
  const notes = input.notes === null || input.notes === undefined ? "" : input.notes;
  if (typeof notes !== "string" || notes.trim().length > MAX_NOTES) {
    return { ok: false, message: `Keep notes to ${MAX_NOTES} characters.` };
  }
  const taxCategoryId = parseOptionalId(input.taxCategoryId);
  if (taxCategoryId === undefined) return { ok: false, message: "That tax category is not valid." };
  return { ok: true, value: { name, notes: notes.trim(), taxCategoryId } };
}

/** Dollars typed by the owner, as integer cents. Zero is a real amount; empty is not one. */
function parseAmount(value: unknown): Parsed<number> {
  if (typeof value !== "string" || value.trim() === "") return { ok: false, message: "Enter an amount." };
  const cents = parseDollarsToCents(value);
  if (cents === null) return { ok: false, message: "Enter dollars and cents, like 120 or 120.50." };
  if (cents > MAX_LIMIT_CENTS) return { ok: false, message: "That amount is above $1,000,000." };
  return { ok: true, value: cents };
}

/** The amount to store: none for an item with sub-items (its total is theirs), else the one typed. */
function amountFor(item: StoredItem, raw: unknown): Parsed<number | null> {
  const typed = typeof raw === "string" && raw.trim() !== "";
  if (item.subItemCount === 0) return parseAmount(raw);
  if (typed) return { ok: false, message: "This item's amount is the total of its sub-items." };
  return { ok: true, value: null };
}

/** A top-level item takes the frequency chosen; a sub-item keeps its parent's and has no tags of its own. */
function frequencyFor(item: StoredItem, raw: unknown, businessIds: string[]): Parsed<Frequency> {
  if (!item.parentId) {
    return isFrequency(raw) ? { ok: true, value: raw } : { ok: false, message: "Choose monthly or annual." };
  }
  if (raw !== null && raw !== undefined && raw !== "" && raw !== item.frequency) {
    return { ok: false, message: "A sub-item has its parent's frequency." };
  }
  if (businessIds.length > 0) return { ok: false, message: 'A sub-item is "For" whatever its parent is for.' };
  return { ok: true, value: item.frequency };
}

function isFrequency(value: unknown): value is Frequency {
  return typeof value === "string" && FREQUENCIES.has(value);
}

// Reads and writes, run under the owner's RLS scope, so another owner's rows are never found.

async function loadItem(tx: Queryable, itemId: string): Promise<StoredItem | null> {
  const r = await tx.query<{ parent_id: string | null; frequency: Frequency; tax_category_id: string | null; sub_items: string }>(
    `SELECT i.parent_id, i.frequency, i.tax_category_id,
            (SELECT count(*) FROM planned_items c WHERE c.parent_id = i.id) AS sub_items
       FROM planned_items i WHERE i.id = $1`,
    [itemId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    parentId: row.parent_id,
    frequency: row.frequency,
    taxCategoryId: row.tax_category_id,
    subItemCount: Number(row.sub_items),
  };
}

/** Says which chosen tax category or business does not exist, or null when all do. */
export async function missingReference(tx: Queryable, taxCategoryId: string | null, businessIds: string[]): Promise<string | null> {
  if (taxCategoryId) {
    const r = await tx.query("SELECT 1 FROM tax_categories WHERE id = $1", [taxCategoryId]);
    if (r.rows.length === 0) return "That tax category does not exist.";
  }
  if (businessIds.length > 0) {
    const r = await tx.query<{ n: string }>("SELECT count(*) AS n FROM businesses WHERE id = ANY($1::uuid[])", [businessIds]);
    if (Number(r.rows[0]?.n ?? 0) !== businessIds.length) return "That business does not exist.";
  }
  return null;
}

async function replaceTags(tx: Queryable, ownerId: string, itemId: string, businessIds: string[]): Promise<void> {
  await tx.query("DELETE FROM planned_item_businesses WHERE owner_id = $1 AND item_id = $2", [ownerId, itemId]);
  if (businessIds.length === 0) return;
  await tx.query(
    `INSERT INTO planned_item_businesses (owner_id, item_id, business_id)
     SELECT $1, $2, business_id FROM unnest($3::uuid[]) AS business_id`,
    [ownerId, itemId, businessIds],
  );
}
