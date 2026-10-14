const RING_RADIUS = 138;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type DialGeometry = {
  /** Length of the red arc, capped at one full turn. */
  filled: number;
  /** Length of the pale arc that marks spending past income, if any. */
  overflow: number;
  /** Spending minus income in cents; positive means overspent. */
  deficitCents: number;
} | null;

/**
 * Work out the ring geometry from real totals. Returns null when either total
 * is unknown or income is not positive, so the dial draws an empty outline
 * rather than inventing a shape.
 */
export function dialGeometry(
  incomeCents: number | null,
  spendingCents: number | null,
): DialGeometry {
  if (incomeCents === null || spendingCents === null || incomeCents <= 0) {
    return null;
  }
  const ratio = Math.max(0, spendingCents) / incomeCents;
  return {
    filled: RING_CIRCUMFERENCE * Math.min(ratio, 1),
    overflow: ratio > 1 ? RING_CIRCUMFERENCE * Math.min(ratio - 1, 1) : 0,
    deficitCents: spendingCents - incomeCents,
  };
}

/**
 * Font size (in the dial's 400-unit viewBox) for the centre figure. The inner
 * ring leaves about 230 units of width; Big Shoulders 900 digits average about
 * half an em, so longer figures shrink to fit instead of overflowing the ring.
 */
export function dialFontSize(text: string): number {
  const fit = Math.floor(230 / (Math.max(text.length, 1) * 0.5));
  return Math.max(36, Math.min(96, fit));
}
