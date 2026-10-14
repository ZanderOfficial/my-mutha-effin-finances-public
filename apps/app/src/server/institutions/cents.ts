/**
 * Plaid reports balances as dollar floats. Money here is integer cents, so
 * convert once, at ingest, without trusting binary floating point.
 *
 * `Math.round(x * 100)` is wrong for values such as 1.005 (the float is
 * 1.00499999999999989...), so the value is first rendered to six decimals,
 * which absorbs binary noise, and the cents are then read from the decimal
 * string. Half-cents round away from zero. `null`, `undefined`, NaN and
 * infinities stay `null` ("unknown", never zero). A value that cannot be an
 * exact safe integer of cents throws rather than silently losing precision.
 */
export function toCents(dollars: number | null | undefined): number | null {
  if (dollars === null || dollars === undefined) return null;
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) return null;

  const negative = dollars < 0;
  const [whole, frac = ""] = Math.abs(dollars).toFixed(6).split(".");
  let cents = Number(whole) * 100 + Number(frac.slice(0, 2));
  if (frac.charCodeAt(2) >= 53 /* "5" */) cents += 1;

  const n = negative ? -cents : cents;
  if (!Number.isSafeInteger(n)) {
    throw new RangeError("Amount does not fit in safe integer cents");
  }
  // Avoid returning -0 for tiny negatives that round to zero.
  return n === 0 ? 0 : n;
}
