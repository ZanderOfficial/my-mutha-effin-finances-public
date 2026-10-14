import type { Queryable } from "@/server/db";
import { DEPOSIT_STATUS_SQL, FLOW_EXCLUSION_SQL, SORTING_JOINS_SQL, markedTransferSql, ownTransferSql } from "@/lib/flow";
import type { IncomeDeposit } from "@/lib/income";
import type { MonthWindow } from "@/lib/month";

/**
 * Read queries behind the five screens. Every function takes the owner-scoped
 * `tx` from `withOwner` (so row-level security applies) and ALSO filters on
 * `owner_id`, so a mistake in one layer is not the whole defence. Nothing here
 * writes, and nothing invents a value: a missing row is `null` or an empty
 * list, never a zero.
 *
 * Dates are returned as YYYY-MM-DD text (`to_char`) so the driver never turns a
 * calendar date into an instant in the server's time zone. bigint and SUM come
 * back as strings; `cents()` makes them safe integers or unknown.
 */

export function cents(value: string | number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export const DAY = "YYYY-MM-DD";

export type MonthFlow = {
  /** True once any (non-removed) transaction exists. False means every figure is unknown. */
  dataKnown: boolean;
  incomeCents: number | null;
  spendingCents: number | null;
  /** Counted rows still pending this month. */
  pendingCount: number;
  /** Deposits this month the owner has not sorted yet, so income may be understated. */
  unsortedCount: number;
  /** Spending over the same days last month; null if nothing predates this month. */
  prevSpendingCents: number | null;
};

/** Every non-removed transaction of the owner, with its deposit status (see lib/flow.ts). */
export const CLASSIFIED_TRANSACTIONS = `(
  SELECT t.*, ${DEPOSIT_STATUS_SQL} AS deposit_status,
         -- Half of a move between the owner's own accounts, unless the owner decided this row themselves.
         (${ownTransferSql("t")} AND c.transaction_id IS NULL) AS own_transfer,
         -- Money that left and came back, as the owner marked it: neither spending nor in the budget.
         COALESCE(c.kind = 'not_spending', false) AS marked_not_spending,
         ${markedTransferSql("t")} AS marked_transfer,
         CASE WHEN c.kind IN ('income', 'not_income') THEN c.business_id ELSE r.business_id END AS business_id
    FROM transactions t ${SORTING_JOINS_SQL}
   WHERE t.owner_id = $1 AND t.removed_at IS NULL
)`;

export async function readMonthFlow(
  tx: Queryable,
  ownerId: string,
  w: MonthWindow,
): Promise<MonthFlow> {
  const r = await tx.query<{
    total_rows: string;
    rows_before_month: string;
    income: string;
    spending: string;
    pending_count: string;
    unsorted_count: string;
    prev_spending: string;
  }>(
    `SELECT
       count(*) AS total_rows,
       count(*) FILTER (WHERE date < $2::date) AS rows_before_month,
       COALESCE(SUM(amount_cents) FILTER (
         WHERE date >= $2::date AND date < $3::date AND deposit_status = 'income'), 0) AS income,
       COALESCE(-SUM(amount_cents) FILTER (
         WHERE date >= $2::date AND date < $3::date
           AND amount_cents < 0 AND NOT ${FLOW_EXCLUSION_SQL} AND NOT own_transfer AND NOT marked_not_spending AND NOT marked_transfer), 0) AS spending,
       count(*) FILTER (
         WHERE date >= $2::date AND date < $3::date AND pending
           AND (deposit_status = 'income' OR (amount_cents < 0 AND NOT ${FLOW_EXCLUSION_SQL} AND NOT own_transfer AND NOT marked_not_spending AND NOT marked_transfer))) AS pending_count,
       count(*) FILTER (
         WHERE date >= $2::date AND date < $3::date AND deposit_status = 'unsorted') AS unsorted_count,
       COALESCE(-SUM(amount_cents) FILTER (
         WHERE date >= $4::date AND date < $5::date
           AND amount_cents < 0 AND NOT ${FLOW_EXCLUSION_SQL} AND NOT own_transfer AND NOT marked_not_spending AND NOT marked_transfer), 0) AS prev_spending
     FROM ${CLASSIFIED_TRANSACTIONS} t`,
    [ownerId, w.start, w.endExclusive, w.prevStart, w.prevSameDayEndExclusive],
  );
  const row = r.rows[0];
  const total = Number(row?.total_rows ?? 0);
  if (!row || total === 0) {
    return {
      dataKnown: false,
      incomeCents: null,
      spendingCents: null,
      pendingCount: 0,
      unsortedCount: 0,
      prevSpendingCents: null,
    };
  }
  return {
    dataKnown: true,
    incomeCents: cents(row.income),
    spendingCents: cents(row.spending),
    pendingCount: Number(row.pending_count),
    unsortedCount: Number(row.unsorted_count),
    prevSpendingCents: Number(row.rows_before_month) > 0 ? cents(row.prev_spending) : null,
  };
}

export type DepositsForYear = {
  /** The owner's earliest non-removed transaction, or null with none. */
  historyStart: string | null;
  deposits: IncomeDeposit[];
};

/** Every deposit in one calendar year, with its status and business, oldest first. */
export async function readDepositsForYear(
  tx: Queryable,
  ownerId: string,
  year: number,
): Promise<DepositsForYear> {
  const r = await tx.query<{
    id: string;
    date: string;
    label: string;
    amount_cents: string;
    pending: boolean;
    deposit_status: IncomeDeposit["status"];
    business_id: string | null;
  }>(
    `SELECT t.id, to_char(t.date, '${DAY}') AS date, COALESCE(t.merchant, t.name) AS label,
            t.amount_cents, t.pending, t.deposit_status, t.business_id
       FROM ${CLASSIFIED_TRANSACTIONS} t
      WHERE t.deposit_status <> 'not_a_deposit'
        AND t.date >= make_date($2, 1, 1) AND t.date < make_date($2 + 1, 1, 1)
      ORDER BY t.date, t.created_at, t.id`,
    [ownerId, year],
  );
  const deposits = r.rows.flatMap((row) => {
    const amountCents = cents(row.amount_cents);
    if (amountCents === null) return [];
    return [{
      id: row.id,
      date: row.date,
      label: row.label,
      amountCents,
      pending: row.pending,
      status: row.deposit_status,
      businessId: row.business_id,
    }];
  });
  return { historyStart: await readHistoryStart(tx, ownerId), deposits };
}

/** The owner's earliest non-removed transaction date: where known history begins. */
export async function readHistoryStart(tx: Queryable, ownerId: string): Promise<string | null> {
  const r = await tx.query<{ start: string | null }>(
    `SELECT to_char(min(date), '${DAY}') AS start FROM transactions WHERE owner_id = $1 AND removed_at IS NULL`,
    [ownerId],
  );
  return r.rows[0]?.start ?? null;
}

export type TxRow = {
  id: string;
  date: string;
  name: string;
  merchant: string | null;
  category: string | null;
  accountName: string;
  /** Normalised: spending negative, income positive. */
  amountCents: number;
  pending: boolean;
  /** A transfer or card payment: listed, but not counted as income or spending. */
  excluded: boolean;
};

type TxDbRow = {
  id: string;
  date: string;
  name: string;
  merchant: string | null;
  category: string | null;
  account_name: string;
  amount_cents: string;
  pending: boolean;
  excluded: boolean;
};

const TX_COLUMNS = `t.id, to_char(t.date, '${DAY}') AS date, t.name, t.merchant, t.category,
       a.name AS account_name, t.amount_cents, t.pending, (${FLOW_EXCLUSION_SQL} OR ${ownTransferSql("t")} OR ${markedTransferSql("t")}) AS excluded`;

function toTxRow(r: TxDbRow): TxRow | null {
  const amountCents = cents(r.amount_cents);
  if (amountCents === null) return null;
  return {
    id: r.id,
    date: r.date,
    name: r.name,
    merchant: r.merchant,
    category: r.category,
    accountName: r.account_name,
    amountCents,
    pending: r.pending,
    excluded: r.excluded,
  };
}

const ORDER = "ORDER BY t.date DESC, t.created_at DESC, t.id DESC";

export async function readLatestTransactions(
  tx: Queryable,
  ownerId: string,
  limit: number,
): Promise<TxRow[]> {
  const r = await tx.query<TxDbRow>(
    `SELECT ${TX_COLUMNS}
       FROM transactions t
       JOIN accounts a ON a.owner_id = t.owner_id AND a.id = t.account_id
      WHERE t.owner_id = $1 AND t.removed_at IS NULL
      ${ORDER} LIMIT $2`,
    [ownerId, limit],
  );
  return r.rows.flatMap((row) => toTxRow(row) ?? []);
}

export type TxFlowFilter = "all" | "spending" | "income";

/** Escapes LIKE wildcards so "50%" searches for 50%, not for 50 followed by anything. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

export async function readTransactionsPage(
  tx: Queryable,
  ownerId: string,
  opts: { flow: TxFlowFilter; q: string; page: number; pageSize: number },
): Promise<{ rows: TxRow[]; total: number }> {
  const params: unknown[] = [ownerId];
  const where = ["t.owner_id = $1", "t.removed_at IS NULL"];
  if (opts.flow === "spending") where.push("t.amount_cents < 0");
  if (opts.flow === "income") where.push("t.amount_cents > 0");
  if (opts.q) {
    params.push(`%${escapeLike(opts.q)}%`);
    const n = params.length;
    where.push(`(t.merchant ILIKE $${n} ESCAPE '\\' OR t.name ILIKE $${n} ESCAPE '\\')`);
  }
  const clause = where.join(" AND ");

  const count = await tx.query<{ n: string }>(
    `SELECT count(*) AS n FROM transactions t WHERE ${clause}`,
    params,
  );
  const total = Number(count.rows[0]?.n ?? 0);

  const r = await tx.query<TxDbRow>(
    `SELECT ${TX_COLUMNS}
       FROM transactions t
       JOIN accounts a ON a.owner_id = t.owner_id AND a.id = t.account_id
      WHERE ${clause}
      ${ORDER}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
  );
  return { rows: r.rows.flatMap((row) => toTxRow(row) ?? []), total };
}

export type NetWorthDay = {
  date: string;
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  /** Some balance was unknown that day, so the row understates net worth. */
  incomplete: boolean;
};

type NetWorthDbRow = {
  date: string;
  assets_cents: string;
  liabilities_cents: string;
  net_worth_cents: string;
  incomplete: boolean;
};

function toDay(r: NetWorthDbRow): NetWorthDay | null {
  const assets = cents(r.assets_cents);
  const liabilities = cents(r.liabilities_cents);
  const net = cents(r.net_worth_cents);
  if (assets === null || liabilities === null || net === null) return null;
  return {
    date: r.date,
    assetsCents: assets,
    liabilitiesCents: liabilities,
    netWorthCents: net,
    incomplete: r.incomplete,
  };
}

export async function readLatestNetWorth(
  tx: Queryable,
  ownerId: string,
): Promise<NetWorthDay | null> {
  const r = await tx.query<NetWorthDbRow>(
    `SELECT to_char(date, '${DAY}') AS date, assets_cents, liabilities_cents,
            net_worth_cents, incomplete
       FROM net_worth_daily WHERE owner_id = $1 ORDER BY date DESC LIMIT 1`,
    [ownerId],
  );
  return r.rows[0] ? toDay(r.rows[0]) : null;
}

/** Oldest first. `from` is inclusive; null means all history. */
export async function readNetWorthSeries(
  tx: Queryable,
  ownerId: string,
  from: string | null,
): Promise<NetWorthDay[]> {
  const r = await tx.query<NetWorthDbRow>(
    `SELECT to_char(date, '${DAY}') AS date, assets_cents, liabilities_cents,
            net_worth_cents, incomplete
       FROM net_worth_daily
      WHERE owner_id = $1 AND ($2::date IS NULL OR date >= $2::date)
      ORDER BY date ASC`,
    [ownerId, from],
  );
  return r.rows.flatMap((row) => toDay(row) ?? []);
}

export type AccountLine = {
  id: string;
  name: string;
  institutionName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  isLiability: boolean;
  /** For liabilities this is the positive amount owed. Null is unknown. */
  balanceCents: number | null;
  /** Item needs reconnecting, so the balance may be old. */
  stale: boolean;
};

export async function readAccounts(tx: Queryable, ownerId: string): Promise<AccountLine[]> {
  const r = await tx.query<{
    id: string;
    name: string;
    institution_name: string | null;
    type: string;
    subtype: string | null;
    mask: string | null;
    is_liability: boolean;
    balance_cents: string | null;
    status: string;
  }>(
    `SELECT a.id, a.name, i.institution_name, a.type, a.subtype, a.mask,
            a.is_liability, a.balance_cents, i.status
       FROM accounts a
       JOIN items i ON i.owner_id = a.owner_id AND i.id = a.item_id
      WHERE a.owner_id = $1 AND a.closed_at IS NULL
      ORDER BY i.institution_name NULLS LAST, a.name, a.id`,
    [ownerId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    institutionName: row.institution_name,
    type: row.type,
    subtype: row.subtype,
    mask: row.mask,
    isLiability: row.is_liability,
    balanceCents: cents(row.balance_cents),
    stale: row.status !== "active",
  }));
}

export type HoldingLine = {
  name: string;
  ticker: string | null;
  securityType: string | null;
  accountName: string;
  valueCents: number | null;
};

export async function readHoldings(tx: Queryable, ownerId: string): Promise<HoldingLine[]> {
  const r = await tx.query<{
    name: string | null;
    ticker: string | null;
    type: string | null;
    account_name: string;
    value: string | null;
  }>(
    `SELECT s.name, s.ticker, s.type, a.name AS account_name, h.institution_value_cents AS value
       FROM holdings h
       JOIN securities s ON s.owner_id = h.owner_id AND s.id = h.security_id
       JOIN accounts a ON a.owner_id = h.owner_id AND a.id = h.account_id
      WHERE h.owner_id = $1 AND a.closed_at IS NULL
      ORDER BY a.name, s.name, h.id`,
    [ownerId],
  );
  return r.rows.map((row) => ({
    name: row.name ?? row.ticker ?? "Unknown security",
    ticker: row.ticker,
    securityType: row.type,
    accountName: row.account_name,
    valueCents: cents(row.value),
  }));
}

export type DebtLine = {
  id: string;
  name: string;
  institutionName: string | null;
  subtype: string | null;
  mask: string | null;
  /** Positive amount owed; null is unknown. */
  balanceCents: number | null;
  limitCents: number | null;
  /** The liabilities row's kind, or null when Plaid has reported no details. */
  kind: string | null;
  nextDueDate: string | null;
  /** The minimum due, or for a loan its scheduled next payment. */
  minPaymentCents: number | null;
  aprBps: number | null;
  aprType: string | null;
  payoffCents: number | null;
  maturityDate: string | null;
  lastPaymentCents: number | null;
  lastPaymentDate: string | null;
  stale: boolean;
};

export async function readDebts(tx: Queryable, ownerId: string): Promise<DebtLine[]> {
  const r = await tx.query<{
    id: string;
    name: string;
    institution_name: string | null;
    subtype: string | null;
    mask: string | null;
    balance_cents: string | null;
    limit_cents: string | null;
    next_due: string | null;
    min_payment: string | null;
    kind: string | null;
    apr_bps: number | null;
    apr_type: string | null;
    payoff: string | null;
    maturity: string | null;
    last_payment: string | null;
    last_paid: string | null;
    status: string;
  }>(
    `SELECT a.id, a.name, i.institution_name, a.subtype, a.mask, a.balance_cents,
            a.limit_cents, to_char(l.next_due_date, '${DAY}') AS next_due,
            l.min_payment_cents AS min_payment, l.kind, l.apr_bps, l.apr_type,
            l.payoff_cents AS payoff, to_char(l.maturity_date, '${DAY}') AS maturity,
            l.last_payment_cents AS last_payment,
            to_char(l.last_payment_date, '${DAY}') AS last_paid, i.status
       FROM accounts a
       JOIN items i ON i.owner_id = a.owner_id AND i.id = a.item_id
       LEFT JOIN liabilities l ON l.owner_id = a.owner_id AND l.account_id = a.id
      WHERE a.owner_id = $1 AND a.is_liability AND a.closed_at IS NULL
      ORDER BY i.institution_name NULLS LAST, a.name, a.id`,
    [ownerId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    institutionName: row.institution_name,
    subtype: row.subtype,
    mask: row.mask,
    balanceCents: cents(row.balance_cents),
    limitCents: cents(row.limit_cents),
    kind: row.kind,
    nextDueDate: row.next_due,
    minPaymentCents: cents(row.min_payment),
    aprBps: row.apr_bps,
    aprType: row.apr_type,
    payoffCents: cents(row.payoff),
    maturityDate: row.maturity,
    lastPaymentCents: cents(row.last_payment),
    lastPaymentDate: row.last_paid,
    stale: row.status !== "active",
  }));
}

export type ItemLine = { id: string; institutionName: string | null; status: string };

export async function readItems(tx: Queryable, ownerId: string): Promise<ItemLine[]> {
  const r = await tx.query<{ id: string; institution_name: string | null; status: string }>(
    `SELECT id, institution_name, status FROM items
      WHERE owner_id = $1 ORDER BY created_at, id`,
    [ownerId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    institutionName: row.institution_name,
    status: row.status,
  }));
}
