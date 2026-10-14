import { formatShortDate } from "./format";
import { formatBps } from "./invest";
import { formatCents } from "./money";

/** A loan has a scheduled payment; a card or line of credit has a minimum. */
export function paymentLabel(kind: string | null): "payment" | "minimum" {
  return kind === "loan" ? "payment" : "minimum";
}

const RATE_TYPES = new Set(["fixed", "variable"]);

/**
 * The facts line for a loan or line of credit on the Debts view, built only
 * from what Plaid reported. An unknown fact is left out rather than shown as
 * zero; a real zero (a paid-off balance) still shows.
 */
export function loanFacts(d: {
  aprBps: number | null;
  aprType: string | null;
  payoffCents: number | null;
  maturityDate: string | null;
  lastPaymentCents: number | null;
  lastPaymentDate: string | null;
}): string[] {
  const out: string[] = [];
  if (d.aprBps !== null) {
    const type = d.aprType !== null && RATE_TYPES.has(d.aprType) ? `${d.aprType} ` : "";
    out.push(`${formatBps(d.aprBps)} ${type}rate`);
  }
  if (d.payoffCents !== null) out.push(`payoff ${formatCents(d.payoffCents)}`);
  if (d.maturityDate !== null) out.push(`ends ${formatShortDate(d.maturityDate, true)}`);
  if (d.lastPaymentCents !== null) {
    const when = d.lastPaymentDate !== null ? ` on ${formatShortDate(d.lastPaymentDate)}` : "";
    out.push(`last paid ${formatCents(d.lastPaymentCents)}${when}`);
  }
  return out;
}
