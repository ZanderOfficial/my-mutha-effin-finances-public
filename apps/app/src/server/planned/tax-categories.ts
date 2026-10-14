// The owner's tax categories: adding, renaming and removing them, and mapping each to a Schedule C line.
import { STARTING_CATEGORIES, STARTING_SET_YEAR, parseMapping } from "@/lib/tax-categories";
import type { Queryable } from "@/server/db";
import { isUuid, parseName } from "@/server/form-values";
import { OK, fail, type Run, type WriteResult } from "@/server/write-result";

const MAX_CATEGORY_NAME = 80;
const NAME_RULE = `Enter a category name of up to ${MAX_CATEGORY_NAME} characters.`;

export async function addTaxCategory(run: Run, ownerId: string, rawName: unknown): Promise<WriteResult> {
  const name = parseName(rawName, MAX_CATEGORY_NAME);
  if (!name) return fail(NAME_RULE);

  return run(ownerId, async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO tax_categories (owner_id, name) VALUES ($1, $2) ON CONFLICT (owner_id, name) DO NOTHING RETURNING id`,
      [ownerId, name],
    );
    return inserted.rows.length > 0 ? OK : fail("You already have a category with that name.");
  });
}

export async function renameTaxCategory(
  run: Run,
  ownerId: string,
  categoryId: unknown,
  rawName: unknown,
): Promise<WriteResult> {
  if (!isUuid(categoryId)) return fail("That category is not valid.");
  const name = parseName(rawName, MAX_CATEGORY_NAME);
  if (!name) return fail(NAME_RULE);

  return run(ownerId, async (tx) => {
    const taken = await tx.query("SELECT 1 FROM tax_categories WHERE name = $1 AND id <> $2", [name, categoryId]);
    if (taken.rows.length > 0) return fail("You already have a category with that name.");
    const updated = await tx.query(
      "UPDATE tax_categories SET name = $3 WHERE owner_id = $1 AND id = $2 RETURNING id",
      [ownerId, categoryId, name],
    );
    return updated.rows.length > 0 ? OK : fail("That category does not exist.");
  });
}

/** Removes a category. Items that used it keep their place and lose only the category. */
export async function removeTaxCategory(run: Run, ownerId: string, categoryId: unknown): Promise<WriteResult> {
  if (!isUuid(categoryId)) return fail("That category is not valid.");
  return run(ownerId, async (tx) => {
    await tx.query("DELETE FROM tax_categories WHERE owner_id = $1 AND id = $2", [ownerId, categoryId]);
    return OK;
  });
}

/** Puts a category on a Schedule C line, marks it personal, or clears it. Saving confirms the mapping. */
export async function mapTaxCategory(
  run: Run,
  ownerId: string,
  input: { categoryId: unknown; mapping: unknown },
): Promise<WriteResult> {
  const { categoryId } = input;
  if (!isUuid(categoryId)) return fail("That category is not valid.");
  const mapping = parseMapping(input.mapping);
  if (!mapping) return fail("Choose a Schedule C line, personal, or not mapped.");
  const year = mapping.kind === "line" ? mapping.year : null;
  const line = mapping.kind === "line" ? mapping.line : null;

  return run(ownerId, async (tx) => {
    if (year !== null && line !== null && !(await isScheduleCLine(tx, year, line))) {
      return fail("That line is not on the Schedule C form.");
    }
    const updated = await tx.query(
      `UPDATE tax_categories
          SET schedule_c_year = $3, schedule_c_line = $4, personal = $5, mapping_confirmed = true
        WHERE owner_id = $1 AND id = $2 RETURNING id`,
      [ownerId, categoryId, year, line, mapping.kind === "personal"],
    );
    return updated.rows.length > 0 ? OK : fail("That category does not exist.");
  });
}

/** Adds the owner's spreadsheet list with its proposed lines, unconfirmed. Names already there are left alone. */
export async function addStartingCategories(run: Run, ownerId: string): Promise<WriteResult> {
  const lineOf = (proposed: string | null) => (proposed === null || proposed === "personal" ? null : proposed);
  const names = STARTING_CATEGORIES.map((c) => c.name);
  const lines = STARTING_CATEGORIES.map((c) => lineOf(c.proposed));
  const years = lines.map((line) => (line === null ? null : STARTING_SET_YEAR));
  const personal = STARTING_CATEGORIES.map((c) => c.proposed === "personal");

  return run(ownerId, async (tx) => {
    await tx.query(
      `INSERT INTO tax_categories (owner_id, name, schedule_c_year, schedule_c_line, personal)
       SELECT $1, name, year, line, personal
         FROM unnest($2::text[], $3::smallint[], $4::text[], $5::boolean[]) AS s(name, year, line, personal)
       ON CONFLICT (owner_id, name) DO NOTHING`,
      [ownerId, names, years, lines, personal],
    );
    return OK;
  });
}

async function isScheduleCLine(tx: Queryable, year: number, line: string): Promise<boolean> {
  const r = await tx.query("SELECT 1 FROM reference.schedule_c_lines WHERE tax_year = $1 AND line = $2", [year, line]);
  return r.rows.length > 0;
}
