import { vi } from "vitest";
import { runWithOwner, type Queryable } from "@/server/db/run-with-owner";
import { openTestDb } from "@/server/db/test-db";
import { createInstitutionRepo, type AccountRow } from "@/server/institutions/repository";
import type {
  PlaidAccountInfo,
  PlaidProvider,
  TransactionsSyncPage,
} from "@/server/plaid/types";
import { createSyncRepo } from "./repository";

/**
 * Test-only helpers: PGlite with the real migrations, applied as the runtime
 * role, plus a scriptable fake PlaidProvider. Every value is synthetic and
 * lives only in test files; the app cannot reach any of it.
 */
export async function setupDb() {
  const pg = await openTestDb();
  const db = pg as unknown as Queryable;
  const run = <T>(owner: string, fn: (tx: Queryable) => Promise<T>) =>
    runWithOwner(db, owner, fn);
  const lookup = async <Row>(text: string, params?: unknown[]) =>
    (await pg.query<Row>(text, params)).rows;
  return {
    pg,
    db,
    run,
    syncRepo: createSyncRepo(run, lookup),
    instRepo: createInstitutionRepo(run),
  };
}

export function account(id: string, over: Partial<AccountRow> = {}): AccountRow {
  return {
    plaidAccountId: id,
    name: "Account",
    officialName: null,
    type: "depository",
    subtype: "checking",
    isLiability: false,
    balanceCents: 10000,
    availableCents: null,
    limitCents: null,
    isoCurrencyCode: "USD",
    mask: "0001",
    ...over,
  };
}

export function accountInfo(id: string, over: Partial<PlaidAccountInfo> = {}): PlaidAccountInfo {
  return {
    accountId: id,
    name: "Account",
    officialName: null,
    type: "depository",
    subtype: "checking",
    mask: "0001",
    currentDollars: 100,
    availableDollars: null,
    limitDollars: null,
    isoCurrencyCode: "USD",
    ...over,
  };
}

export function page(over: Partial<TransactionsSyncPage> = {}): TransactionsSyncPage {
  return { added: [], modified: [], removed: [], nextCursor: "cur-end", hasMore: false, ...over };
}

export function txn(id: string, accountId: string, amountDollars: number, over = {}) {
  return {
    transactionId: id,
    accountId,
    amountDollars,
    date: "2026-01-15",
    pending: false,
    name: "Test merchant",
    merchantName: null,
    categoryPrimary: "FOOD_AND_DRINK",
    categoryDetailed: null,
    ...over,
  };
}

/** A PlaidProvider whose every method is a vi.fn; override what a test needs. */
export function fakePlaid(over: Partial<PlaidProvider> = {}): PlaidProvider {
  const unused = () =>
    vi.fn(async () => {
      throw new Error("not scripted");
    });
  return {
    createLinkToken: unused(),
    createUpdateLinkToken: unused(),
    exchangePublicToken: unused(),
    getItem: unused(),
    getAccounts: vi.fn(async () => []),
    transactionsSync: unused(),
    transactionsRefresh: vi.fn(async () => undefined),
    getLiabilities: vi.fn(async () => []),
    getInvestmentsHoldings: vi.fn(async () => ({ accountIds: [], holdings: [], securities: [] })),
    getWebhookVerificationKey: unused(),
    removeItem: vi.fn(async () => undefined),
    ...over,
  } as PlaidProvider;
}

export const fakeDecrypt = () => "access-test-token";

/** Saves an Item for `owner` and returns its row id. */
export async function seedItem(
  ctx: Awaited<ReturnType<typeof setupDb>>,
  owner: string,
  plaidItemId: string,
  accounts: AccountRow[],
  status: "active" | "needs_reauth" | "revoked" = "active",
) {
  return ctx.instRepo.saveItem(owner, {
    plaidItemId,
    token: { ciphertext: Buffer.alloc(40, 3), keyVersion: 1 },
    institutionId: "ins_test",
    institutionName: "Test Bank",
    status,
    lastErrorCode: null,
    accounts,
  });
}
