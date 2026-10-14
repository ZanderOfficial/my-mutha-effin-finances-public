/**
 * The adapter contract. Screens, route handlers and services depend on this
 * interface only; the vendor SDK is imported in `sdk-provider.ts` and nowhere
 * else. Shapes here are neutral (no SDK types leak out) and deliberately
 * small. Balances are Plaid's raw dollar floats; conversion to integer cents
 * happens once, in `src/server/institutions/cents.ts`.
 */
export type PlaidAccountInfo = {
  accountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  /** Last 2 to 4 characters. Restricted data; never log it. */
  mask: string | null;
  currentDollars: number | null;
  availableDollars: number | null;
  limitDollars: number | null;
  isoCurrencyCode: string | null;
};

export type PlaidItemInfo = {
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
  /** Plaid's error_code when the Item is in an error state, else null. */
  errorCode: string | null;
};

/** One transaction as Plaid reports it. Outflows are POSITIVE here; normalised at ingest. */
export type PlaidTransaction = {
  transactionId: string;
  accountId: string;
  amountDollars: number;
  /** YYYY-MM-DD. */
  date: string;
  pending: boolean;
  name: string;
  merchantName: string | null;
  /** personal_finance_category.primary, e.g. FOOD_AND_DRINK. */
  categoryPrimary: string | null;
  categoryDetailed: string | null;
  /** On a posted transaction: the id of the pending one it replaces. */
  pendingTransactionId?: string | null;
};

export type TransactionsSyncPage = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transactionId: string; accountId: string }[];
  nextCursor: string;
  hasMore: boolean;
};

export type PlaidLiability = {
  accountId: string;
  kind: "credit" | "mortgage" | "student" | "loan" | "line_of_credit";
  nextDueDate: string | null;
  /** The minimum due, or for a loan its scheduled next payment. */
  minPaymentDollars: number | null;
  lastStatementBalanceDollars: number | null;
  lastStatementDate: string | null;
  /** Percent as Plaid reports it (24.99); converted to basis points at ingest. */
  aprPercentage: number | null;
  aprType: string | null;
  /** Loans and lines of credit only; absent means not reported. */
  payoffDollars?: number | null;
  maturityDate?: string | null;
  lastPaymentDollars?: number | null;
  lastPaymentDate?: string | null;
};

export type PlaidHolding = {
  accountId: string;
  securityId: string;
  quantity: number;
  institutionValueDollars: number | null;
  costBasisDollars: number | null;
  priceAsOf: string | null;
};

export type PlaidSecurity = {
  securityId: string;
  name: string | null;
  ticker: string | null;
  type: string | null;
  closePriceDollars: number | null;
  closePriceAsOf: string | null;
};

/** The public JWK Plaid signs webhooks with (ES256). */
export type PlaidWebhookKey = {
  alg: string;
  crv: string;
  kid: string;
  kty: string;
  use: string;
  x: string;
  y: string;
  /** Unix seconds, or null while the key is current. */
  expiredAt: number | null;
};

export type LinkTokenResult = { linkToken: string; expiration: string };

export interface PlaidProvider {
  /** New link: Transactions (730 days, permanent per Item) plus optional Liabilities and Investments. */
  createLinkToken(input: { ownerId: string }): Promise<LinkTokenResult>;
  /** Update mode: repairs an existing Item. No products are requested. */
  createUpdateLinkToken(input: {
    ownerId: string;
    accessToken: string;
  }): Promise<LinkTokenResult>;
  exchangePublicToken(
    publicToken: string,
  ): Promise<{ accessToken: string; itemId: string }>;
  getItem(accessToken: string): Promise<PlaidItemInfo>;
  /** Cached balances (/accounts/get, free), never the per-call billed endpoint. */
  getAccounts(accessToken: string): Promise<PlaidAccountInfo[]>;
  /**
   * /transactions/sync. A null cursor starts from the beginning. Throws a
   * PlaidApiError with code TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION when
   * the data changed mid-loop; the caller must restart from its first cursor.
   */
  transactionsSync(accessToken: string, cursor: string | null): Promise<TransactionsSyncPage>;
  /** Asks Plaid to re-pull the institution. Billed; not used by the sync loop. */
  transactionsRefresh(accessToken: string): Promise<void>;
  getLiabilities(accessToken: string): Promise<PlaidLiability[]>;
  getInvestmentsHoldings(accessToken: string): Promise<{
    accountIds: string[];
    holdings: PlaidHolding[];
    securities: PlaidSecurity[];
  }>;
  /** /webhook_verification_key/get for the `kid` in a webhook's JWT header. */
  getWebhookVerificationKey(kid: string): Promise<PlaidWebhookKey>;
  /** /item/remove: invalidates the token and stops billing for the Item. */
  removeItem(accessToken: string): Promise<void>;
}
