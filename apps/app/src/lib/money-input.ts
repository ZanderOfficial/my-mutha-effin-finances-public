import { formatCents } from "./money";

/** The largest budget limit accepted: $1,000,000.00. */
export const MAX_LIMIT_CENTS = 100_000_000;

/**
 * Reads what the owner typed into a dollars field as integer cents, with no
 * float maths: an optional "$", comma grouping, whole dollars, and at most two
 * decimals ("45", "$1,200", "12.5", "0.99"). Anything else (negative,
 * exponent, three decimals, text, empty) is null. Not clamped; the caller
 * applies its own bounds.
 */
export function parseDollarsToCents(input: string): number | null {
  const t = input.trim().replace(/^\$/, "");
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!match) return null;
  const dollars = Number(match[1].replace(/,/g, ""));
  const cents = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** Integer cents as the plain text a limit field shows: 45050 is "450.50", 45000 is "450". */
export function centsToDollarsInput(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(dollars) : `${dollars}.${String(rest).padStart(2, "0")}`;
}

/** Integer cents as a table cell shows them for editing: 185000 is "$1,850.00", which parseDollarsToCents reads back. */
export function centsToCellInput(cents: number): string {
  return formatCents(cents);
}
