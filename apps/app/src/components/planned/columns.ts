// The planned table's columns, counted once for every row that spans or skips some of them.
import type { PlannedView } from "@/lib/planned-budget";

/** Planned (×12, Annual view only), Spent and Standing: the figures a draft row leaves blank. */
export function figureColumns(period: PlannedView): number {
  return period === "annual" ? 3 : 2;
}

/** For, Tax category, Status, Notes, save state and ⋯: the columns after Standing. */
export const AFTER_STANDING = 6;

/** Name, Amount, Freq, the figures, then the columns after Standing. */
export function plannedColumnCount(period: PlannedView): number {
  return 3 + figureColumns(period) + AFTER_STANDING;
}

/** The Annual view hides Notes so the table fits a laptop; the notes still post with the row. */
export function notesColumn(period: PlannedView): string {
  return period === "annual" ? "hidden" : "";
}
