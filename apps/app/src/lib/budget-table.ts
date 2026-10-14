// Decisions the Budget tables make about a row: which fields it posts, and the words and glyphs for each state.
import { standing, type BudgetActuals, type Standing } from "./actuals";
import type { MonthState } from "./income";
import { formatCents } from "./money";
import type { ScheduleCLine, TaxCategory } from "./tax-categories";

/** Which of a planned item's fields its row sends; the rest are read-only there. */
export type ItemPosts = { amount: boolean; frequency: boolean; forTags: boolean };

/**
 * A parent's amount is its sub-items' total, so it sends none; a sub-item takes its parent's
 * frequency and "For" tags, so it sends neither (updateItem refuses them).
 */
export function itemPosts(item: { parentId: string | null }, subItemCount: number): ItemPosts {
  if (item.parentId !== null) return { amount: true, frequency: false, forTags: false };
  return { amount: subItemCount === 0, frequency: true, forTags: true };
}

/** A cell's value now, and the value it was last saved with. */
export type FieldValue = { name: string; value: string; saved: string };

/** The cells whose value differs from what was saved: the ones a refused save marks. */
export function changedFields(fields: FieldValue[]): string[] {
  return [...new Set(fields.filter((field) => field.value !== field.saved).map((field) => field.name))];
}

/** Each field's value as a row last saved it, by name. */
export type SavedValues = Record<string, string>;

/** After a post: a saved one's values replace those before it; a refused one changes nothing. */
export function savedAfter(previous: SavedValues, posted: Iterable<[string, FormDataEntryValue]>, saved: boolean): SavedValues {
  if (!saved) return previous;
  const next = { ...previous };
  for (const [name, value] of posted) if (typeof value === "string") next[name] = value;
  return next;
}

/**
 * A select's saved value: the one the row last saved, else the option it rendered selected, else its
 * first. React never updates defaultSelected after a save, so it alone would stay stale.
 */
export function savedSelectValue(name: string, options: { value: string; defaultSelected: boolean }[], saved: SavedValues): string {
  if (name in saved) return saved[name];
  return (options.find((option) => option.defaultSelected) ?? options[0])?.value ?? "";
}

/** A row's fields and values as one string, to tell whether anything changed since the last post. */
export function formSnapshot(entries: Iterable<[string, FormDataEntryValue]>): string {
  return JSON.stringify([...entries].map(([name, value]) => [name, typeof value === "string" ? value : value.name]));
}

/** What sortMerchantAction reads from one "Sort to" choice: "item:<id>", "out", "one", "new", "transfer" or nothing. */
export function sortRequest(choice: string): { do: "" | "item" | "out" | "one" | "new" | "transfer"; itemTarget: string } {
  if (choice === "out" || choice === "one" || choice === "new" || choice === "transfer") return { do: choice, itemTarget: "" };
  const itemId = choice.startsWith("item:") ? choice.slice("item:".length) : "";
  return itemId ? { do: "item", itemTarget: itemId } : { do: "", itemTarget: "" };
}

/** A state in a glyph, words and a tone; the tone only ever adds colour to the words. */
export type StateWords = { glyph: string; words: string; tone: "income" | "spending" | "plain" | "muted" };

/** Planned against actual, from lib/actuals' standing(). */
export function planStanding(state: Standing): StateWords {
  if (state.kind === "left") return { glyph: "✓", words: `${formatCents(state.cents)} left`, tone: "income" };
  if (state.kind === "over") return { glyph: "!", words: `Over by ${formatCents(state.cents)}`, tone: "spending" };
  return { glyph: "=", words: "On the line", tone: "muted" };
}

/** Planned against actual from the two figures, or null while either is unknown. */
export function planStandingOf(plannedCents: number | null, actualCents: number | null): StateWords | null {
  if (plannedCents === null || actualCents === null) return null;
  return planStanding(standing(plannedCents, actualCents));
}

/**
 * How the whole plan stands: the planned total against spending on paying line items only (the owner's
 * decision of 2026-10-09). `comparedCents` is that spending when Spent shows more, so the screen can say so.
 */
export function planVerdict(
  plannedCents: number | null,
  actuals: Pick<BudgetActuals, "totalCents" | "plannedSpentCents">,
): { verdict: StateWords | null; comparedCents: number | null } {
  const verdict = planStandingOf(plannedCents, actuals.plannedSpentCents);
  const differs = verdict !== null && actuals.plannedSpentCents !== actuals.totalCents;
  return { verdict, comparedCents: differs ? actuals.plannedSpentCents : null };
}

/**
 * Income made against the planned total: ahead, covered exactly, or short. A month says "short";
 * the year so far says "to go", since the rest of the year can still close the gap.
 */
export function madeVerdict(plannedCents: number | null, madeCents: number | null, period: "monthly" | "annual"): StateWords | null {
  if (plannedCents === null || madeCents === null) return null;
  const gap = madeCents - plannedCents;
  if (gap > 0) return { glyph: "✓", words: `${formatCents(gap)} ahead`, tone: "income" };
  if (gap === 0) return { glyph: "=", words: "Covered exactly", tone: "muted" };
  const words = period === "annual" ? `${formatCents(-gap)} to go` : `${formatCents(-gap)} short`;
  return { glyph: "!", words, tone: "spending" };
}

const MONTH_STATES: Record<MonthState, { glyph: string; words: string }> = {
  complete: { glyph: "✓", words: "Complete" },
  partial: { glyph: "◐", words: "Partial" },
  future: { glyph: "—", words: "Not yet" },
  before_history: { glyph: "—", words: "Before history" },
};

export function monthStateLabel(state: MonthState): { glyph: string; words: string } {
  return MONTH_STATES[state];
}

export type TaxCategoryState = "proposed" | "confirmed" | "personal" | "none";

/** Nothing chosen is none; anything else stays proposed until the owner saves it. */
export function taxCategoryState(category: TaxCategory): TaxCategoryState {
  if (category.mapping.kind === "unmapped") return "none";
  if (!category.confirmed) return "proposed";
  return category.mapping.kind === "personal" ? "personal" : "confirmed";
}

export type TaxCategoryView = { id: "all" | "confirm" | "personal" | "unmapped"; label: string; categories: TaxCategory[] };

/** The tax category list's filters: everything, what to confirm, personal, and not on a line. */
export function taxCategoryViews(categories: TaxCategory[]): TaxCategoryView[] {
  const where = (state: TaxCategoryState) => categories.filter((category) => taxCategoryState(category) === state);
  return [
    { id: "all", label: "All", categories },
    { id: "confirm", label: "To confirm", categories: where("proposed") },
    { id: "personal", label: "Personal", categories: where("personal") },
    { id: "unmapped", label: "Not on a line", categories: where("none") },
  ];
}

const CELL_CHARACTERS = 32;

/** "18 · Office expense": the line number and the form's words without asides, short enough for a cell. */
export function shortLineName(line: ScheduleCLine): string {
  const words = `${line.heading ? `${line.heading} ` : ""}${line.label}`
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+:/g, ":")
    .replace(/\s+/g, " ")
    .trim();
  const name = `${line.line} · ${words}`;
  return name.length <= CELL_CHARACTERS ? name : `${name.slice(0, CELL_CHARACTERS - 1).trimEnd()}…`;
}

/** What a sorted inbox row says for a moment after it leaves: what happened, and whether a rule now covers the source. */
export function sortedNote(input: { source: string; outcome: string; always: boolean; unit: "charge" | "deposit" }): string {
  if (input.always) return `${input.source} ${input.outcome}, and every later ${input.unit} from it too.`;
  return `The ticked ${input.unit}s from ${input.source} ${input.outcome}. The next one will ask again.`;
}
