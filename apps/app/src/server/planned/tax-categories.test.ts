import { beforeAll, describe, expect, it } from "vitest";
import { STARTING_CATEGORIES } from "@/lib/tax-categories";
import { setupDb, type Ctx } from "@/server/reports/test-helpers";
import { createItem } from "./planned";
import {
  addStartingCategories,
  addTaxCategory,
  mapTaxCategory,
  removeTaxCategory,
  renameTaxCategory,
} from "./tax-categories";

// Synthetic owners and names only; they exist in this file and nowhere else.
const A = "owner-tax-a";
const B = "owner-tax-b";
let ctx: Ctx;

const rows = <T = Record<string, unknown>>(owner: string, sql: string, params: unknown[] = []) =>
  ctx.run(owner, async (tx) => (await tx.query<T & Record<string, unknown>>(sql, params)).rows);
const idOf = async (owner: string, name: string) =>
  (await rows<{ id: string }>(owner, "SELECT id FROM tax_categories WHERE name = $1", [name]))[0].id;

beforeAll(async () => {
  ctx = await setupDb();
});

describe("Schedule C reference lines", () => {
  it("holds the 2025 Part II expense lines with their source and checked date", async () => {
    const lines = await rows<{ line: string; source_url: string; checked_on: string }>(
      A,
      "SELECT line, source_url, to_char(checked_on, 'YYYY-MM-DD') AS checked_on FROM reference.schedule_c_lines WHERE tax_year = 2025 ORDER BY position",
    );
    expect(lines.map((l) => l.line)).toEqual([
      "8", "9", "10", "11", "12", "13", "14", "15", "16a", "16b", "17", "18", "19",
      "20a", "20b", "21", "22", "23", "24a", "24b", "25", "26", "27a", "27b", "30",
    ]);
    expect(lines.every((l) => l.source_url.startsWith("https://www.irs.gov/") && l.checked_on === "2026-10-09")).toBe(true);
  });

  it("cannot be changed by the app's database role", async () => {
    await expect(
      ctx.run(A, (tx) => tx.query("UPDATE reference.schedule_c_lines SET label = 'x' WHERE line = '8'")),
    ).rejects.toThrow();
  });
});

describe("tax categories", () => {
  it("adds, renames and refuses a duplicate or empty name", async () => {
    expect(await addTaxCategory(ctx.run, A, "  Software  ")).toEqual({ ok: true });
    expect((await addTaxCategory(ctx.run, A, "Software")).ok).toBe(false);
    expect((await addTaxCategory(ctx.run, A, "")).ok).toBe(false);
    expect(await renameTaxCategory(ctx.run, A, await idOf(A, "Software"), "Software and apps")).toEqual({ ok: true });
    expect(await rows(A, "SELECT name FROM tax_categories")).toEqual([{ name: "Software and apps" }]);
  });

  it("maps a category to a line, to personal or to nothing, and saving confirms it", async () => {
    const software = await idOf(A, "Software and apps");
    const mapping = () =>
      rows(A, "SELECT schedule_c_year, schedule_c_line, personal, mapping_confirmed FROM tax_categories WHERE id = $1", [software]);

    expect(await mapTaxCategory(ctx.run, A, { categoryId: software, mapping: "line:2025:18" })).toEqual({ ok: true });
    expect(await mapping()).toEqual([{ schedule_c_year: 2025, schedule_c_line: "18", personal: false, mapping_confirmed: true }]);
    await mapTaxCategory(ctx.run, A, { categoryId: software, mapping: "personal" });
    expect(await mapping()).toEqual([{ schedule_c_year: null, schedule_c_line: null, personal: true, mapping_confirmed: true }]);
    await mapTaxCategory(ctx.run, A, { categoryId: software, mapping: "" });
    expect(await mapping()).toEqual([{ schedule_c_year: null, schedule_c_line: null, personal: false, mapping_confirmed: true }]);
  });

  it("refuses a line that is not on the form, and a malformed mapping", async () => {
    const software = await idOf(A, "Software and apps");
    expect(await mapTaxCategory(ctx.run, A, { categoryId: software, mapping: "line:2025:99" })).toEqual({
      ok: false,
      message: "That line is not on the Schedule C form.",
    });
    expect((await mapTaxCategory(ctx.run, A, { categoryId: software, mapping: "line:2025" })).ok).toBe(false);
  });

  it("leaves an item in place, without its category, when the category is removed", async () => {
    await addTaxCategory(ctx.run, A, "Short lived");
    const category = await idOf(A, "Short lived");
    await createItem(ctx.run, A, { name: "Item", amount: "5", frequency: "monthly", notes: "", taxCategoryId: category, businessIds: [] });
    expect(await removeTaxCategory(ctx.run, A, category)).toEqual({ ok: true });
    expect(await rows(A, "SELECT tax_category_id FROM planned_items WHERE name = 'Item'")).toEqual([{ tax_category_id: null }]);
  });
});

describe("the starting set", () => {
  it("adds every spreadsheet category once, with its proposal left unconfirmed", async () => {
    expect(await addStartingCategories(ctx.run, B)).toEqual({ ok: true });
    expect(await addStartingCategories(ctx.run, B)).toEqual({ ok: true });
    const added = await rows<{ name: string; line: string | null; personal: boolean; mapping_confirmed: boolean }>(
      B,
      "SELECT name, schedule_c_line AS line, personal, mapping_confirmed FROM tax_categories",
    );
    expect(added).toHaveLength(STARTING_CATEGORIES.length);
    expect(added.every((c) => !c.mapping_confirmed)).toBe(true);
    expect(added.find((c) => c.name === "Advertising")).toMatchObject({ line: "8", personal: false });
    expect(added.find((c) => c.name === "Other: Recreational")).toMatchObject({ line: null, personal: true });
    expect(added.find((c) => c.name === "Owner Wages (Reported on W2)")).toMatchObject({ line: null, personal: false });
  });

  it("is visible only to the owner who added it", async () => {
    expect(await rows(A, "SELECT 1 FROM tax_categories WHERE name = 'Advertising'")).toEqual([]);
  });
});
