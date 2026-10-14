// The owner's sorting decisions: which sources and transactions are income, and the owner's businesses.
import type { Queryable } from "@/server/db";
import { isUuid, parseIdList, parseName, parseOptionalId } from "@/server/form-values";
import { OK, fail, type Run, type WriteResult } from "@/server/write-result";

const KINDS = new Set(["income", "not_income"]);
const MAX_SOURCE_KEY = 200;
const MAX_BUSINESS_NAME = 60;
const MAX_CHOICES = 500;

/** Treats every transaction from one source, now and later, as income or not income. */
export async function setSourceRule(
  run: Run,
  ownerId: string,
  input: { sourceKey: unknown; kind: unknown; businessId: unknown },
): Promise<WriteResult> {
  const { sourceKey, kind, businessId } = input;
  if (!isSourceKey(sourceKey)) return fail("That source is not valid.");
  if (!isKind(kind)) return fail("Choose income or not income.");
  const business = parseOptionalId(businessId);
  if (business === undefined) return fail("That business is not valid.");

  return run(ownerId, async (tx) => {
    if (!(await hasSource(tx, sourceKey))) return fail("No transactions come from that source.");
    if (business && !(await hasBusiness(tx, business))) return fail("That business does not exist.");

    await tx.query(
      `INSERT INTO transaction_rules (owner_id, scope, source_key, kind, business_id)
       VALUES ($1, 'deposit', $2, $3, $4)
       ON CONFLICT (owner_id, scope, source_key) DO UPDATE SET
         kind = EXCLUDED.kind, business_id = EXCLUDED.business_id, updated_at = now()`,
      [ownerId, sourceKey, kind, business],
    );
    return OK;
  });
}

export async function removeSourceRule(run: Run, ownerId: string, ruleId: unknown): Promise<WriteResult> {
  if (!isUuid(ruleId)) return fail("That rule is not valid.");
  return run(ownerId, async (tx) => {
    await tx.query("DELETE FROM transaction_rules WHERE owner_id = $1 AND id = $2", [ownerId, ruleId]);
    return OK;
  });
}

/** Decides one transaction on its own. It beats any rule for its source. */
export async function setTransactionChoice(
  run: Run,
  ownerId: string,
  input: { transactionId: unknown; kind: unknown; businessId: unknown },
): Promise<WriteResult> {
  const { transactionId, ...rest } = input;
  return setTransactionChoices(run, ownerId, { transactionIds: [transactionId], ...rest });
}

/** Decides several transactions the same way, each on its own, in one write. */
export async function setTransactionChoices(
  run: Run,
  ownerId: string,
  input: { transactionIds: unknown[]; kind: unknown; businessId: unknown },
): Promise<WriteResult> {
  const { kind, businessId } = input;
  const ids = parseIdList(input.transactionIds);
  if (ids === undefined) return fail("That transaction is not valid.");
  if (ids.length === 0) return fail("Tick at least one deposit.");
  if (ids.length > MAX_CHOICES) return fail(`Sort at most ${MAX_CHOICES} deposits at a time.`);
  if (!isKind(kind)) return fail("Choose income or not income.");
  const business = parseOptionalId(businessId);
  if (business === undefined) return fail("That business is not valid.");

  return run(ownerId, async (tx) => {
    if ((await countTransactions(tx, ids)) !== ids.length) return fail("That transaction does not exist.");
    if (business && !(await hasBusiness(tx, business))) return fail("That business does not exist.");

    // An income choice replaces any budget choice on the same transaction, so its budget columns are cleared.
    await tx.query(
      `INSERT INTO transaction_choices (owner_id, transaction_id, kind, business_id)
       SELECT $1, id, $3, $4 FROM unnest($2::uuid[]) AS id
       ON CONFLICT (transaction_id) DO UPDATE SET
         kind = EXCLUDED.kind, business_id = EXCLUDED.business_id,
         planned_item_id = NULL, tax_category_id = NULL, updated_at = now()`,
      [ownerId, ids, kind, business],
    );
    return OK;
  });
}

export async function removeTransactionChoice(
  run: Run,
  ownerId: string,
  transactionId: unknown,
): Promise<WriteResult> {
  if (!isUuid(transactionId)) return fail("That transaction is not valid.");
  return run(ownerId, async (tx) => {
    await tx.query("DELETE FROM transaction_choices WHERE owner_id = $1 AND transaction_id = $2", [
      ownerId,
      transactionId,
    ]);
    return OK;
  });
}

export async function addBusiness(run: Run, ownerId: string, rawName: unknown): Promise<WriteResult> {
  const name = parseName(rawName, MAX_BUSINESS_NAME);
  if (!name) return fail(`Enter a business name of up to ${MAX_BUSINESS_NAME} characters.`);

  return run(ownerId, async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO businesses (owner_id, name) VALUES ($1, $2)
       ON CONFLICT (owner_id, name) DO NOTHING RETURNING id`,
      [ownerId, name],
    );
    return inserted.rows.length > 0 ? OK : fail("You already have a business with that name.");
  });
}

export async function renameBusiness(
  run: Run,
  ownerId: string,
  businessId: unknown,
  rawName: unknown,
): Promise<WriteResult> {
  if (!isUuid(businessId)) return fail("That business is not valid.");
  const name = parseName(rawName, MAX_BUSINESS_NAME);
  if (!name) return fail(`Enter a business name of up to ${MAX_BUSINESS_NAME} characters.`);

  return run(ownerId, async (tx) => {
    const taken = await tx.query("SELECT 1 FROM businesses WHERE owner_id = $1 AND name = $2 AND id <> $3", [
      ownerId,
      name,
      businessId,
    ]);
    if (taken.rows.length > 0) return fail("You already have a business with that name.");

    await tx.query("UPDATE businesses SET name = $3 WHERE owner_id = $1 AND id = $2", [ownerId, businessId, name]);
    return OK;
  });
}

/** Removes a business. Rules, choices and planned items tagged with it lose that tag. */
export async function removeBusiness(run: Run, ownerId: string, businessId: unknown): Promise<WriteResult> {
  if (!isUuid(businessId)) return fail("That business is not valid.");
  return run(ownerId, async (tx) => {
    await tx.query("DELETE FROM businesses WHERE owner_id = $1 AND id = $2", [ownerId, businessId]);
    return OK;
  });
}

// Input checks. Form values arrive as unknown, so each one is narrowed before use.

function isKind(value: unknown): value is "income" | "not_income" {
  return typeof value === "string" && KINDS.has(value);
}

function isSourceKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SOURCE_KEY;
}


// Existence checks, run under the owner's RLS scope, so another owner's rows are never found.

async function hasSource(tx: Queryable, sourceKey: string): Promise<boolean> {
  const r = await tx.query("SELECT 1 FROM transactions WHERE source_key = $1 LIMIT 1", [sourceKey]);
  return r.rows.length > 0;
}

async function countTransactions(tx: Queryable, ids: string[]): Promise<number> {
  const r = await tx.query<{ n: string }>("SELECT count(*) AS n FROM transactions WHERE id = ANY($1::uuid[])", [ids]);
  return Number(r.rows[0]?.n ?? 0);
}

async function hasBusiness(tx: Queryable, businessId: string): Promise<boolean> {
  const r = await tx.query("SELECT 1 FROM businesses WHERE id = $1", [businessId]);
  return r.rows.length > 0;
}
