import { beforeAll, describe, expect, it } from "vitest";
import { setupDb, type Ctx } from "@/server/reports/test-helpers";
import { addSubItem, createItem, deleteItem, setItemStatus, updateItem } from "./planned";

// Synthetic owners, names and amounts only; they exist in this file and nowhere else.
const A = "owner-plan-a";
const B = "owner-plan-b";
let ctx: Ctx;
let studio: string;
let shop: string;
let software: string;

const rows = <T = Record<string, unknown>>(owner: string, sql: string, params: unknown[] = []) =>
  ctx.run(owner, async (tx) => (await tx.query<T & Record<string, unknown>>(sql, params)).rows);

const item = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  amount: "120",
  frequency: "monthly",
  notes: "",
  taxCategoryId: "",
  businessIds: [] as unknown[],
  ...over,
});

const idOf = async (owner: string, name: string) =>
  (await rows<{ id: string }>(owner, "SELECT id FROM planned_items WHERE name = $1", [name]))[0].id;

const edit = (itemId: string, over: Record<string, unknown> = {}) => ({
  itemId,
  name: "Edited",
  amount: "10",
  frequency: "monthly",
  notes: "",
  taxCategoryId: "",
  businessIds: [] as unknown[],
  ...over,
});

beforeAll(async () => {
  ctx = await setupDb();
  [studio, shop, software] = await ctx.run(A, async (tx) => {
    const add = async (sql: string, name: string) => (await tx.query<{ id: string }>(sql, [A, name])).rows[0].id;
    return [
      await add("INSERT INTO businesses (owner_id, name) VALUES ($1, $2) RETURNING id", "Studio"),
      await add("INSERT INTO businesses (owner_id, name) VALUES ($1, $2) RETURNING id", "Shop"),
      await add("INSERT INTO tax_categories (owner_id, name) VALUES ($1, $2) RETURNING id", "Software"),
    ];
  });
});

describe("items", () => {
  it("adds an item with its amount in cents and a shared cost tagged with each business", async () => {
    const result = await createItem(ctx.run, A, item("Hosting", { amount: "1,200.50", businessIds: [studio, shop, studio], taxCategoryId: software }));
    expect(result).toEqual({ ok: true });
    const [saved] = await rows(A, "SELECT amount_cents, frequency, status, tax_category_id FROM planned_items WHERE name = 'Hosting'");
    expect(saved).toEqual({ amount_cents: 120050, frequency: "monthly", status: "active", tax_category_id: software });
    const tags = await rows<{ business_id: string }>(A, "SELECT business_id FROM planned_item_businesses");
    expect(tags.map((t) => t.business_id).sort()).toEqual([studio, shop].sort());
  });

  it("refuses an amount that is empty, a float of cents, negative or over the cap", async () => {
    for (const amount of ["", "12.345", "-5", "1e3", "1000000.01"]) {
      expect((await createItem(ctx.run, A, item("Bad", { amount }))).ok, amount).toBe(false);
    }
    expect((await createItem(ctx.run, A, item("Bad", { frequency: "weekly" }))).ok).toBe(false);
    expect((await createItem(ctx.run, A, item(" "))).ok).toBe(false);
    expect(await rows(A, "SELECT 1 FROM planned_items WHERE name = 'Bad'")).toEqual([]);
  });

  it("edits a row and replaces its tags, so untagging makes it personal", async () => {
    await createItem(ctx.run, A, item("Phone", { businessIds: [studio] }));
    const phone = await idOf(A, "Phone");
    expect(await updateItem(ctx.run, A, edit(phone, { name: "Phone plan", amount: "80", frequency: "annual" }))).toEqual({ ok: true });
    const [saved] = await rows(A, "SELECT name, amount_cents, frequency FROM planned_items WHERE id = $1", [phone]);
    expect(saved).toEqual({ name: "Phone plan", amount_cents: 8000, frequency: "annual" });
    expect(await rows(A, "SELECT 1 FROM planned_item_businesses WHERE item_id = $1", [phone])).toEqual([]);
  });

  it("greys an item out and back", async () => {
    await createItem(ctx.run, A, item("Gym"));
    const gym = await idOf(A, "Gym");
    expect(await setItemStatus(ctx.run, A, { itemId: gym, status: "not_paying" })).toEqual({ ok: true });
    expect(await rows(A, "SELECT status FROM planned_items WHERE id = $1", [gym])).toEqual([{ status: "not_paying" }]);
    expect((await setItemStatus(ctx.run, A, { itemId: gym, status: "paused" })).ok).toBe(false);
  });
});

describe("sub-items", () => {
  let utilities: string;

  beforeAll(async () => {
    await createItem(ctx.run, A, item("Utilities", { amount: "300", taxCategoryId: software, businessIds: [studio] }));
    utilities = await idOf(A, "Utilities");
  });

  it("takes its parent's frequency, and its tax category when the form sends none", async () => {
    expect(await addSubItem(ctx.run, A, { parentId: utilities, name: "Electric", amount: "120", notes: "", taxCategoryId: null })).toEqual({ ok: true });
    const [electric] = await rows(A, "SELECT frequency, tax_category_id FROM planned_items WHERE name = 'Electric'");
    expect(electric).toEqual({ frequency: "monthly", tax_category_id: software });
  });

  it("honours a tax category of None on a new sub-item", async () => {
    await createItem(ctx.run, A, item("Phones", { amount: "50", taxCategoryId: software }));
    const phones = await idOf(A, "Phones");
    expect(await addSubItem(ctx.run, A, { parentId: phones, name: "Water", amount: "30", notes: "", taxCategoryId: "" })).toEqual({ ok: true });
    const [water] = await rows(A, "SELECT tax_category_id FROM planned_items WHERE name = 'Water'");
    expect(water).toEqual({ tax_category_id: null });
  });

  it("carries a parent's new frequency to its sub-items", async () => {
    await updateItem(ctx.run, A, edit(utilities, { name: "Utilities", amount: "", frequency: "annual", businessIds: [studio] }));
    expect(await rows(A, "SELECT frequency FROM planned_items WHERE parent_id = $1", [utilities])).toEqual([{ frequency: "annual" }]);
  });

  it("keeps a parent's amount as the sub-items' total, so it cannot be typed over", async () => {
    const result = await updateItem(ctx.run, A, edit(utilities, { name: "Utilities", amount: "999", frequency: "annual" }));
    expect(result).toEqual({ ok: false, message: "This item's amount is the total of its sub-items." });
  });

  it("refuses a sub-item of a sub-item, in the write and in the database", async () => {
    const electric = await idOf(A, "Electric");
    expect(await addSubItem(ctx.run, A, { parentId: electric, name: "Deeper", amount: "1", notes: "", taxCategoryId: "" })).toEqual({
      ok: false,
      message: "A sub-item cannot have sub-items.",
    });
    await expect(
      ctx.run(A, (tx) =>
        tx.query(
          `INSERT INTO planned_items (owner_id, parent_id, name, amount_cents, frequency) VALUES ($1, $2, 'Deeper', 1, 'annual')`,
          [A, electric],
        ),
      ),
    ).rejects.toThrow(/cannot have sub-items/);
  });

  it("refuses in the database a sub-item whose frequency differs from its parent's", async () => {
    await expect(
      ctx.run(A, (tx) =>
        tx.query(
          `INSERT INTO planned_items (owner_id, parent_id, name, amount_cents, frequency) VALUES ($1, $2, 'Odd', 1, 'monthly')`,
          [A, utilities],
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses a sub-item its own frequency or tags", async () => {
    const electric = await idOf(A, "Electric");
    expect((await updateItem(ctx.run, A, edit(electric, { frequency: "monthly" }))).ok).toBe(false);
    expect((await updateItem(ctx.run, A, edit(electric, { frequency: "", businessIds: [shop] }))).ok).toBe(false);
    expect(await updateItem(ctx.run, A, edit(electric, { name: "Electric", amount: "130", frequency: "" }))).toEqual({ ok: true });
  });

  it("asks before deleting an item with sub-items, then deletes them with it", async () => {
    expect(await deleteItem(ctx.run, A, { itemId: utilities, withSubItems: null })).toEqual({
      ok: false,
      message: "Deleting this item also deletes its sub-item. Confirm to go ahead.",
    });
    expect(await deleteItem(ctx.run, A, { itemId: utilities, withSubItems: "1" })).toEqual({ ok: true });
    expect(await rows(A, "SELECT 1 FROM planned_items WHERE id = $1 OR parent_id = $1", [utilities])).toEqual([]);
    expect(await rows(A, "SELECT 1 FROM planned_item_businesses WHERE item_id = $1", [utilities])).toEqual([]);
  });
});

describe("other owners", () => {
  it("sees none of the first owner's items, tags or tax categories, and cannot edit them", async () => {
    for (const table of ["planned_items", "planned_item_businesses", "tax_categories"]) {
      expect(await rows(B, `SELECT 1 FROM ${table}`), table).toEqual([]);
    }
    const hosting = await idOf(A, "Hosting");
    expect(await updateItem(ctx.run, B, edit(hosting))).toEqual({ ok: false, message: "That item does not exist." });
    expect(await deleteItem(ctx.run, B, { itemId: hosting, withSubItems: "1" })).toEqual({ ok: false, message: "That item does not exist." });
    expect((await addSubItem(ctx.run, B, { parentId: hosting, name: "Mine", amount: "1", notes: "", taxCategoryId: "" })).ok).toBe(false);
  });

  it("cannot use the first owner's business or tax category", async () => {
    expect(await createItem(ctx.run, B, item("Theirs", { businessIds: [studio] }))).toEqual({ ok: false, message: "That business does not exist." });
    expect(await createItem(ctx.run, B, item("Theirs", { taxCategoryId: software }))).toEqual({
      ok: false,
      message: "That tax category does not exist.",
    });
  });
});
