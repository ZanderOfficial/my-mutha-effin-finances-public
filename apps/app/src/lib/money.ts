/** Money is integer cents everywhere. These helpers format at the edge only. */

const MINUS = "−";
const EMPTY = "—";

export type FormatOptions = {
  /** Prefix positive amounts with "+". */
  sign?: boolean;
  /** Drop ".00" from whole-dollar amounts (for sentences: "$412", not "$412.00"). */
  trimZeroCents?: boolean;
};

/**
 * Format integer cents as dollars. `null` means "unknown" and renders as an
 * em dash, never as 0.00: a real zero and a missing value must look different.
 */
export function formatCents(
  cents: number | null | undefined,
  options: FormatOptions = {},
): string {
  if (cents === null || cents === undefined) return EMPTY;
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("formatCents expects an integer number of cents");
  }

  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const fraction =
    options.trimZeroCents && remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`;
  const body = `$${dollars.toLocaleString("en-US")}${fraction}`;

  if (cents < 0) return `${MINUS}${body}`;
  if (cents > 0 && options.sign) return `+${body}`;
  return body;
}

const COMPACT_FROM_CENTS = 1_000_000_000; // $10,000,000

/**
 * Hero-size notation: the full value up to seven figures of dollars, then
 * $12.3M or $1.2B. The full value belongs in a tooltip and a screen-reader
 * label. Truncates (never rounds up) so the shown figure is never larger than
 * the real one.
 */
export function formatCentsCompact(
  cents: number | null | undefined,
  options: FormatOptions = {},
): string {
  if (cents === null || cents === undefined) return EMPTY;
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("formatCentsCompact expects an integer number of cents");
  }
  const abs = Math.abs(cents);
  if (abs < COMPACT_FROM_CENTS) return formatCents(cents, options);
  const billion = abs >= 100_000_000_000;
  const unit = billion ? 100_000_000_000 : 100_000_000;
  const tenths = Math.floor(abs / (unit / 10));
  const body = `$${Math.floor(tenths / 10)}.${tenths % 10}${billion ? "B" : "M"}`;
  if (cents < 0) return `${MINUS}${body}`;
  return cents > 0 && options.sign ? `+${body}` : body;
}
