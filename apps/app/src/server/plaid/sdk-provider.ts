import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";
import type { PlaidConfig } from "./config";
import { normalisePlaidError } from "./errors";
import type { PlaidLiability, PlaidProvider, PlaidTransaction } from "./types";

/**
 * The only module that imports the Plaid SDK (official `plaid` package,
 * MIT). Request and response bodies are never logged: errors are normalised
 * to a code and a message we wrote ourselves.
 */

/** Permanent per Item: it cannot be raised later without relinking. */
export const DAYS_REQUESTED = 730;
const CLIENT_NAME = "MMFF";

/**
 * Derives the Link `client_user_id` from the owner id. It is a stable opaque
 * label, not an email: the owner id is already an opaque Neon Auth user id.
 */
export function clientUserIdFor(ownerId: string): string {
  return `mmff-${ownerId}`;
}

type SdkTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  pending: boolean;
  name: string;
  merchant_name?: string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
  pending_transaction_id?: string | null;
};

function toTransaction(t: SdkTransaction): PlaidTransaction {
  return {
    transactionId: t.transaction_id,
    accountId: t.account_id,
    amountDollars: t.amount,
    date: t.date,
    pending: t.pending,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    categoryPrimary: t.personal_finance_category?.primary ?? null,
    categoryDetailed: t.personal_finance_category?.detailed ?? null,
    pendingTransactionId: t.pending_transaction_id ?? null,
  };
}

/** Prefers the purchase APR, else the first listed. */
function pickApr(aprs: { apr_percentage: number; apr_type: string }[]) {
  return aprs.find((a) => a.apr_type === "purchase_apr") ?? aprs[0] ?? null;
}

export function createPlaidProvider(config: PlaidConfig): PlaidProvider {
  const api = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[config.env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": config.clientId,
          "PLAID-SECRET": config.secret,
        },
      },
    }),
  );

  const base = (ownerId: string) => ({
    client_name: CLIENT_NAME,
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: clientUserIdFor(ownerId) },
    ...(config.webhookUrl ? { webhook: config.webhookUrl } : {}),
    // Required for OAuth banks, in new and update mode alike. Omitted when not
    // configured, so non-OAuth banks keep working without it.
    ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
  });

  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw normalisePlaidError(err);
    }
  }

  return {
    createLinkToken: ({ ownerId }) =>
      call(async () => {
        const { data } = await api.linkTokenCreate({
          ...base(ownerId),
          products: [Products.Transactions],
          // Optional so an institution that lacks one is still linkable.
          optional_products: [Products.Liabilities, Products.Investments],
          transactions: { days_requested: DAYS_REQUESTED },
        });
        return { linkToken: data.link_token, expiration: data.expiration };
      }),

    createUpdateLinkToken: ({ ownerId, accessToken }) =>
      call(async () => {
        const { data } = await api.linkTokenCreate({
          ...base(ownerId),
          access_token: accessToken,
        });
        return { linkToken: data.link_token, expiration: data.expiration };
      }),

    exchangePublicToken: (publicToken) =>
      call(async () => {
        const { data } = await api.itemPublicTokenExchange({ public_token: publicToken });
        return { accessToken: data.access_token, itemId: data.item_id };
      }),

    getItem: (accessToken) =>
      call(async () => {
        const { data } = await api.itemGet({ access_token: accessToken });
        return {
          itemId: data.item.item_id,
          institutionId: data.item.institution_id ?? null,
          institutionName: data.item.institution_name ?? null,
          errorCode: data.item.error?.error_code ?? null,
        };
      }),

    getAccounts: (accessToken) =>
      call(async () => {
        // /accounts/get returns cached balances. /accounts/balance/get is
        // billed per call and is deliberately not used.
        const { data } = await api.accountsGet({ access_token: accessToken });
        return data.accounts.map((a) => ({
          accountId: a.account_id,
          name: a.name,
          officialName: a.official_name ?? null,
          type: String(a.type),
          subtype: a.subtype ? String(a.subtype) : null,
          mask: a.mask ?? null,
          currentDollars: a.balances.current ?? null,
          availableDollars: a.balances.available ?? null,
          limitDollars: a.balances.limit ?? null,
          isoCurrencyCode: a.balances.iso_currency_code ?? null,
        }));
      }),

    transactionsSync: (accessToken, cursor) =>
      call(async () => {
        const { data } = await api.transactionsSync({
          access_token: accessToken,
          ...(cursor ? { cursor } : {}),
          count: 500,
          options: { include_personal_finance_category: true },
        });
        return {
          added: data.added.map(toTransaction),
          modified: data.modified.map(toTransaction),
          removed: data.removed.map((r) => ({
            transactionId: r.transaction_id,
            accountId: r.account_id,
          })),
          nextCursor: data.next_cursor,
          hasMore: data.has_more,
        };
      }),

    transactionsRefresh: (accessToken) =>
      call(async () => {
        await api.transactionsRefresh({ access_token: accessToken });
      }),

    getLiabilities: (accessToken) =>
      call(async () => {
        const { data } = await api.liabilitiesGet({ access_token: accessToken });
        const out: PlaidLiability[] = [];
        for (const c of data.liabilities.credit ?? []) {
          if (!c.account_id) continue;
          const apr = pickApr(c.aprs);
          out.push({
            accountId: c.account_id,
            kind: "credit",
            nextDueDate: c.next_payment_due_date,
            minPaymentDollars: c.minimum_payment_amount,
            lastStatementBalanceDollars: c.last_statement_balance,
            lastStatementDate: c.last_statement_issue_date,
            aprPercentage: apr?.apr_percentage ?? null,
            aprType: apr?.apr_type ?? null,
          });
        }
        for (const m of data.liabilities.mortgage ?? []) {
          out.push({
            accountId: m.account_id,
            kind: "mortgage",
            nextDueDate: m.next_payment_due_date,
            minPaymentDollars: m.next_monthly_payment,
            lastStatementBalanceDollars: null,
            lastStatementDate: null,
            aprPercentage: m.interest_rate?.percentage ?? null,
            aprType: m.interest_rate?.type ?? null,
          });
        }
        for (const s of data.liabilities.student ?? []) {
          if (!s.account_id) continue;
          out.push({
            accountId: s.account_id,
            kind: "student",
            nextDueDate: s.next_payment_due_date,
            minPaymentDollars: s.minimum_payment_amount,
            lastStatementBalanceDollars: s.last_statement_balance ?? null,
            lastStatementDate: s.last_statement_issue_date,
            aprPercentage: s.interest_rate_percentage ?? null,
            aprType: null,
          });
        }
        // Closed-end loans (auto, personal and others). Fields are picked one
        // by one: the object also carries `account_number`, which is
        // prohibited data and is never read.
        for (const l of data.liabilities.loan ?? []) {
          out.push({
            accountId: l.account_id,
            kind: "loan",
            nextDueDate: l.next_payment_due_date,
            minPaymentDollars: l.next_payment_amount,
            lastStatementBalanceDollars: null,
            lastStatementDate: null,
            aprPercentage: l.interest_rate?.percentage ?? null,
            aprType: l.interest_rate?.type ?? null,
            payoffDollars: l.payoff_amount,
            maturityDate: l.maturity_date,
            lastPaymentDollars: l.last_payment_amount,
            lastPaymentDate: l.last_payment_date,
          });
        }
        for (const c of data.liabilities.line_of_credit ?? []) {
          const apr = pickApr(c.aprs);
          out.push({
            accountId: c.account_id,
            kind: "line_of_credit",
            nextDueDate: c.next_payment_due_date,
            minPaymentDollars: c.minimum_payment_amount ?? c.next_payment_amount,
            lastStatementBalanceDollars: c.last_statement_balance,
            lastStatementDate: c.last_statement_issue_date,
            aprPercentage: apr?.apr_percentage ?? c.interest_rate?.percentage ?? null,
            aprType: apr?.apr_type ?? c.interest_rate?.type ?? null,
            lastPaymentDollars: c.last_payment_amount,
            lastPaymentDate: c.last_payment_date,
          });
        }
        return out;
      }),

    getInvestmentsHoldings: (accessToken) =>
      call(async () => {
        const { data } = await api.investmentsHoldingsGet({ access_token: accessToken });
        return {
          accountIds: data.accounts.map((a) => a.account_id),
          holdings: data.holdings.map((h) => ({
            accountId: h.account_id,
            securityId: h.security_id,
            quantity: h.quantity,
            institutionValueDollars: h.institution_value ?? null,
            costBasisDollars: h.cost_basis ?? null,
            priceAsOf: h.institution_price_as_of ?? null,
          })),
          securities: data.securities.map((s) => ({
            securityId: s.security_id,
            name: s.name ?? null,
            ticker: s.ticker_symbol ?? null,
            type: s.type ?? null,
            closePriceDollars: s.close_price ?? null,
            closePriceAsOf: s.close_price_as_of ?? null,
          })),
        };
      }),

    getWebhookVerificationKey: (kid) =>
      call(async () => {
        const { data } = await api.webhookVerificationKeyGet({ key_id: kid });
        const k = data.key;
        return {
          alg: k.alg,
          crv: k.crv,
          kid: k.kid,
          kty: k.kty,
          use: k.use,
          x: k.x,
          y: k.y,
          expiredAt: k.expired_at ?? null,
        };
      }),

    removeItem: (accessToken) =>
      call(async () => {
        await api.itemRemove({ access_token: accessToken });
      }),
  };
}
