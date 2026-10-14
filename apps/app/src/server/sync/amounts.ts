import { toCents } from "@/server/institutions/cents";

/**
 * Plaid reports a transaction amount in dollars with OUTFLOWS POSITIVE
 * (a coffee is 4.50, a paycheck is -2000.00). The app stores spending as
 * NEGATIVE and income as POSITIVE, so the sign is flipped here, once, at
 * ingest, and the dollars become integer cents via `toCents` (no float maths).
 * `null` stays `null` (unknown, never zero), and a zero never becomes -0.
 */
export function normaliseAmountCents(plaidDollars: number | null | undefined): number | null {
  const cents = toCents(plaidDollars);
  if (cents === null) return null;
  return cents === 0 ? 0 : -cents;
}
