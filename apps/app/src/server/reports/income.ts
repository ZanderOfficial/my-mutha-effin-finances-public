// Read queries behind the Income tab's sorting: unsorted deposits, rules, hand-sorted deposits and businesses.
import type { Queryable } from "@/server/db";
import type { Business, HandSortedDeposit, SourceRule, UnsortedDeposit } from "@/lib/sorting";
import { CLASSIFIED_TRANSACTIONS, DAY, cents } from "./repository";

/** Every deposit across all history that no choice, rule or Plaid label has decided, newest first. */
export async function readUnsortedDeposits(tx: Queryable, ownerId: string): Promise<UnsortedDeposit[]> {
  const r = await tx.query<{
    id: string;
    date: string;
    name: string;
    label: string;
    amount_cents: string;
    pending: boolean;
    source_key: string;
  }>(
    `SELECT t.id, to_char(t.date, '${DAY}') AS date, t.name, COALESCE(t.merchant, t.name) AS label,
            t.amount_cents, t.pending, t.source_key
       FROM ${CLASSIFIED_TRANSACTIONS} t
      WHERE t.deposit_status = 'unsorted'
      ORDER BY t.date DESC, t.created_at DESC, t.id DESC`,
    [ownerId],
  );
  return r.rows.flatMap((row) => {
    const amountCents = cents(row.amount_cents);
    if (amountCents === null) return [];
    return [{
      id: row.id,
      date: row.date,
      name: row.name,
      label: row.label,
      amountCents,
      pending: row.pending,
      sourceKey: row.source_key,
    }];
  });
}

/** The owner's deposit rules (income sorting), each labelled by the latest deposit from its source. */
export async function readSourceRules(tx: Queryable, ownerId: string): Promise<SourceRule[]> {
  const r = await tx.query<{
    id: string;
    source_key: string;
    kind: SourceRule["kind"];
    business_name: string | null;
    label: string | null;
    deposit_count: string;
  }>(
    `SELECT r.id, r.source_key, r.kind, b.name AS business_name, s.label, s.deposit_count
       FROM transaction_rules r
       LEFT JOIN businesses b ON b.owner_id = r.owner_id AND b.id = r.business_id
       LEFT JOIN LATERAL (
         SELECT (array_agg(COALESCE(t.merchant, t.name) ORDER BY t.date DESC, t.id DESC))[1] AS label,
                count(*) AS deposit_count
           FROM transactions t
          WHERE t.owner_id = r.owner_id AND t.source_key = r.source_key
            AND t.removed_at IS NULL AND t.amount_cents > 0
       ) s ON true
      WHERE r.owner_id = $1 AND r.scope = 'deposit'
      ORDER BY lower(COALESCE(s.label, r.source_key)), r.id`,
    [ownerId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    sourceKey: row.source_key,
    label: row.label ?? row.source_key,
    kind: row.kind,
    businessName: row.business_name,
    depositCount: Number(row.deposit_count),
  }));
}

/** Deposits in one calendar year that the owner decided one at a time as income or not, newest first. */
export async function readHandSorted(tx: Queryable, ownerId: string, year: number): Promise<HandSortedDeposit[]> {
  const r = await tx.query<{
    id: string;
    date: string;
    label: string;
    amount_cents: string;
    kind: HandSortedDeposit["kind"];
    business_name: string | null;
  }>(
    `SELECT t.id, to_char(t.date, '${DAY}') AS date, COALESCE(t.merchant, t.name) AS label,
            t.amount_cents, c.kind, b.name AS business_name
       FROM transaction_choices c
       JOIN transactions t ON t.owner_id = c.owner_id AND t.id = c.transaction_id
       LEFT JOIN businesses b ON b.owner_id = c.owner_id AND b.id = c.business_id
      WHERE c.owner_id = $1 AND c.kind IN ('income', 'not_income') AND t.removed_at IS NULL
        AND t.date >= make_date($2, 1, 1) AND t.date < make_date($2 + 1, 1, 1)
      ORDER BY t.date DESC, t.created_at DESC, t.id DESC`,
    [ownerId, year],
  );
  return r.rows.flatMap((row) => {
    const amountCents = cents(row.amount_cents);
    if (amountCents === null) return [];
    return [{
      id: row.id,
      date: row.date,
      label: row.label,
      amountCents,
      kind: row.kind,
      businessName: row.business_name,
    }];
  });
}

export async function readBusinesses(tx: Queryable, ownerId: string): Promise<Business[]> {
  const r = await tx.query<Business>(
    `SELECT id, name FROM businesses WHERE owner_id = $1 ORDER BY lower(name), id`,
    [ownerId],
  );
  return r.rows.map((row) => ({ id: row.id, name: row.name }));
}
