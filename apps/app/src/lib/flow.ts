import { formatCents } from "./money";

// Which transactions count as spending and income. Each rule has a SQL twin for the database,
// which does the summing; tests run both over one matrix so they cannot drift.

/**
 * Spending: every non-removed negative amount except transfers (moving your own money) and
 * credit card payments (the purchases on the card already count). Other loan payments stay in.
 */
export const FLOW_EXCLUDED_PRIMARY = ["TRANSFER_IN", "TRANSFER_OUT"] as const;
export const FLOW_EXCLUDED_DETAIL = ["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"] as const;

export const FLOW_EXCLUSION_SQL =
  "(COALESCE(category, '') IN ('TRANSFER_IN', 'TRANSFER_OUT') " +
  "OR COALESCE(category_detail, '') = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')";

export function isFlowExcluded(t: {
  category: string | null;
  categoryDetail: string | null;
}): boolean {
  return (
    (t.category !== null && (FLOW_EXCLUDED_PRIMARY as readonly string[]).includes(t.category)) ||
    (t.categoryDetail !== null &&
      (FLOW_EXCLUDED_DETAIL as readonly string[]).includes(t.categoryDetail))
  );
}

/** How far apart, in days, the two halves of a move between the owner's own accounts may post. */
export const OWN_TRANSFER_DAYS = 3;

/**
 * An own-account transfer (the owner, 2026-10-10): another of the owner's accounts has a row of the
 * same amount and opposite sign within OWN_TRANSFER_DAYS. Plaid cannot tell this from a client
 * paying in, so the pair is what proves it. Neither half is income or spending.
 */
export function isOwnTransfer(
  t: { id: string; accountId: string; amountCents: number; date: string },
  others: { id: string; accountId: string; amountCents: number; date: string }[],
): boolean {
  if (t.amountCents === 0) return false;
  return others.some(
    (o) => o.id !== t.id && o.accountId !== t.accountId && o.amountCents === -t.amountCents && daysApart(o.date, t.date) <= OWN_TRANSFER_DAYS,
  );
}

const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** The same rule in SQL, for the transactions row aliased `t`. */
export function ownTransferSql(t: string): string {
  return (
    `(${t}.amount_cents <> 0 AND EXISTS (SELECT 1 FROM transactions o WHERE o.owner_id = ${t}.owner_id ` +
    `AND o.removed_at IS NULL AND o.id <> ${t}.id AND o.account_id <> ${t}.account_id ` +
    `AND o.amount_cents = -${t}.amount_cents ` +
    `AND o.date BETWEEN ${t}.date - ${OWN_TRANSFER_DAYS} AND ${t}.date + ${OWN_TRANSFER_DAYS}))`
  );
}

/**
 * Money out the owner marked a transfer to one of their own accounts (the owner, 2026-10-10): its own
 * choice says so, or it has no choice and its merchant's spending rule does. Neither spending nor income.
 */
export function markedTransferSql(t: string): string {
  const choice = (extra: string) =>
    `EXISTS (SELECT 1 FROM transaction_choices mc WHERE mc.owner_id = ${t}.owner_id AND mc.transaction_id = ${t}.id${extra})`;
  return (
    `(${t}.amount_cents < 0 AND (${choice(" AND mc.kind = 'transfer'")} OR (NOT ${choice("")} AND EXISTS ` +
    `(SELECT 1 FROM transaction_rules ms WHERE ms.owner_id = ${t}.owner_id AND ms.scope = 'spending' ` +
    `AND ms.source_key = ${t}.source_key AND ms.kind = 'transfer'))))`
  );
}

export type DepositStatus = "income" | "not_income" | "unsorted" | "not_a_deposit";

/** The choice kinds that decide a deposit; budget kinds (M9) belong to spending and never change income. */
const INCOME_KINDS = ["income", "not_income"];

/**
 * Income: a deposit is income when the owner's choice for it says so, else not when it is half of
 * an own-account transfer, else the owner's rule for its source, else Plaid's INCOME label.
 * Anything else waits in "unsorted" for the owner. Card payment credits are internal and never count.
 */
export function depositStatus(t: {
  amountCents: number;
  category: string | null;
  categoryDetail: string | null;
  choiceKind: string | null;
  ruleKind: string | null;
  ownTransfer?: boolean;
}): DepositStatus {
  if (t.amountCents <= 0 || t.categoryDetail === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "not_a_deposit";
  const choice = t.choiceKind !== null && INCOME_KINDS.includes(t.choiceKind) ? t.choiceKind : null;
  if (choice === null && t.ownTransfer) return "not_income";
  const decided = choice ?? t.ruleKind;
  if (decided !== null) return decided === "income" ? "income" : "not_income";
  return t.category === "INCOME" ? "income" : "unsorted";
}

/** The owner's income decision for transaction `t`: its income choice `c`, else its deposit rule `r`. */
const DECIDED_SQL = "COALESCE(CASE WHEN c.kind IN ('income', 'not_income') THEN c.kind END, r.kind)";

/** The same rule in SQL, over transaction `t`, its choice `c`, its deposit rule `r` and an own-transfer test. */
export function depositStatusSql(ownTransfer: string): string {
  return (
    "(CASE WHEN t.amount_cents <= 0 " +
    "OR COALESCE(t.category_detail, '') = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' THEN 'not_a_deposit' " +
    `WHEN c.kind IS DISTINCT FROM 'income' AND c.kind IS DISTINCT FROM 'not_income' AND ${ownTransfer} THEN 'not_income' ` +
    `WHEN ${DECIDED_SQL} IS NOT NULL THEN ` +
    `CASE WHEN ${DECIDED_SQL} = 'income' THEN 'income' ELSE 'not_income' END ` +
    "WHEN t.category = 'INCOME' THEN 'income' ELSE 'unsorted' END)"
  );
}

/** The deposit rule for a real transactions row `t`, with its own-transfer test. */
export const DEPOSIT_STATUS_SQL = depositStatusSql(ownTransferSql("t"));

/** The joins DEPOSIT_STATUS_SQL needs: transaction `t`'s choice `c` and its source's deposit rule `r`. */
export const SORTING_JOINS_SQL =
  "LEFT JOIN transaction_choices c ON c.owner_id = t.owner_id AND c.transaction_id = t.id " +
  "LEFT JOIN transaction_rules r ON r.owner_id = t.owner_id AND r.scope = 'deposit' AND r.source_key = t.source_key";

/** Income minus spending (both magnitudes). Negative means overspent. Null if either is unknown. */
export function gapCents(
  incomeCents: number | null,
  spendingCents: number | null,
): number | null {
  if (incomeCents === null || spendingCents === null) return null;
  return incomeCents - spendingCents;
}

export type GapState = "over" | "ahead" | "even";

export function gapState(gap: number): GapState {
  return gap < 0 ? "over" : gap > 0 ? "ahead" : "even";
}

function daysPhrase(daysLeft: number): string {
  if (daysLeft <= 0) return "on the last day of the month";
  return `with ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
}

/**
 * The plain, true sentence on the hero pill. Built only from real numbers;
 * null when the gap is unknown (the pill then says nothing is here yet).
 */
export function gapSentence(gap: number | null, daysLeft: number): string | null {
  if (gap === null) return null;
  const amount = formatCents(Math.abs(gap), { trimZeroCents: true });
  const days = daysPhrase(daysLeft);
  const state = gapState(gap);
  if (state === "over") return `Over by ${amount} ${days}.`;
  if (state === "ahead") return `Ahead by ${amount} ${days}.`;
  return `Dead even ${days}.`;
}

/**
 * The dry second line. A tiny fixed set per state, never composed from data,
 * so it cannot state a wrong number. `dayOfMonth` only rotates the choice.
 */
export const DRY_LINES: Record<GapState, readonly string[]> = {
  over: ["Bold strategy.", "The statement will have notes."],
  ahead: ["Keep it boring.", "Suspiciously responsible."],
  even: ["Do not touch anything."],
};

export function dryLine(gap: number | null, dayOfMonth: number): string | null {
  if (gap === null) return null;
  const set = DRY_LINES[gapState(gap)];
  return set[Math.abs(dayOfMonth) % set.length];
}

export type SpendingDelta = {
  /** Magnitude of the difference in cents. */
  diffCents: number;
  direction: "more" | "less" | "same";
};

/** This month's spending so far against the same days last month. Null if either is unknown. */
export function spendingDelta(
  spendingCents: number | null,
  previousCents: number | null,
): SpendingDelta | null {
  if (spendingCents === null || previousCents === null) return null;
  const diff = spendingCents - previousCents;
  return {
    diffCents: Math.abs(diff),
    direction: diff > 0 ? "more" : diff < 0 ? "less" : "same",
  };
}
