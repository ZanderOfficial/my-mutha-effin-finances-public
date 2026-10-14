// Where keyboard focus goes when the row holding it leaves a table, so it never drops to the page.

/** Each shown row's first control (its name, or an inbox row's first choice), in page order. */
function firstControls(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-first-control]")].filter((control) => !control.closest("[hidden]"));
}

/** Focuses the first control of the row now at `index`, or of the last row if the list got shorter. False when no row is left. */
export function focusRowAt(container: ParentNode | null, index: number): boolean {
  const controls = container ? firstControls(container) : [];
  const control = controls[Math.min(index, controls.length - 1)];
  if (!control) return false;
  control.focus();
  return true;
}

/**
 * Where focus should go once `from` leaves its table (the row, or for "group" the <tbody> of rows it
 * heads): the next row's first control, else the table's "+ New" line, else the row before.
 */
export function focusTargetAfter(from: HTMLElement, scope: "row" | "group"): HTMLElement | null {
  const gone = scope === "group" ? (from.closest("tbody") ?? from) : from;
  const table = gone.closest("table");
  if (!table) return null;
  const controls = firstControls(table).filter((control) => !gone.contains(control));
  const next = controls.find((control) => follows(control, gone));
  if (next) return next;
  return newRowLine(table) ?? controls.filter((control) => !follows(control, gone)).pop() ?? null;
}

/** Moves focus on from a row that is being hidden while it holds focus, such as one a filter no longer shows. */
export function focusPastRow(row: HTMLElement) {
  focusTargetAfter(row, "row")?.focus();
}

function follows(node: Node, reference: Node): boolean {
  return Boolean(reference.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function newRowLine(table: HTMLTableElement): HTMLElement | null {
  return [...table.querySelectorAll<HTMLElement>("[data-new-row]")].find((line) => !line.closest("[hidden]")) ?? null;
}
