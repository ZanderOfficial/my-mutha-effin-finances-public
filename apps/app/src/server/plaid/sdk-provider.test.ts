import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal hand-written stand-in for the SDK, local to this test. It records
// the request bodies the adapter builds and returns tiny response shapes.
const calls: { name: string; body: Record<string, unknown> }[] = [];
let failWith: unknown = null;

vi.mock("plaid", () => {
  class PlaidApi {
    private async rec(name: string, body: Record<string, unknown>) {
      calls.push({ name, body });
      if (failWith) throw failWith;
    }
    async linkTokenCreate(b: Record<string, unknown>) {
      await this.rec("linkTokenCreate", b);
      return { data: { link_token: "link-test-token", expiration: "2030-01-01T00:00:00Z" } };
    }
    async itemPublicTokenExchange(b: Record<string, unknown>) {
      await this.rec("exchange", b);
      return { data: { access_token: "access-test", item_id: "item-test" } };
    }
    async itemGet(b: Record<string, unknown>) {
      await this.rec("itemGet", b);
      return {
        data: {
          item: {
            item_id: "item-test",
            institution_id: "ins_x",
            institution_name: "Test Bank",
            error: { error_code: "ITEM_LOGIN_REQUIRED" },
          },
        },
      };
    }
    async accountsGet(b: Record<string, unknown>) {
      await this.rec("accountsGet", b);
      return {
        data: {
          accounts: [
            {
              account_id: "a1",
              name: "Chk",
              official_name: null,
              type: "depository",
              subtype: "checking",
              mask: "0001",
              balances: { current: 10.5, available: null, limit: null, iso_currency_code: "USD" },
            },
          ],
        },
      };
    }
    async transactionsSync(b: Record<string, unknown>) {
      await this.rec("transactionsSync", b);
      return {
        data: {
          added: [
            {
              transaction_id: "t1",
              account_id: "a1",
              amount: 4.5,
              date: "2026-01-02",
              pending: false,
              name: "Cafe",
              merchant_name: "Cafe",
              personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
              pending_transaction_id: "t1-pending",
            },
          ],
          modified: [],
          removed: [{ transaction_id: "t0", account_id: "a1" }],
          next_cursor: "cur-2",
          has_more: true,
        },
      };
    }
    async liabilitiesGet(b: Record<string, unknown>) {
      await this.rec("liabilitiesGet", b);
      return {
        data: {
          liabilities: {
            credit: [
              {
                account_id: "a2",
                aprs: [
                  { apr_percentage: 29.99, apr_type: "cash_apr" },
                  { apr_percentage: 24.99, apr_type: "purchase_apr" },
                ],
                last_statement_balance: 10,
                last_statement_issue_date: "2026-01-01",
                minimum_payment_amount: 25,
                next_payment_due_date: "2026-02-01",
              },
              { account_id: null, aprs: [] },
            ],
            mortgage: null,
            student: null,
            loan: [
              {
                account_id: "a4",
                // Prohibited data: a full account number must never be read.
                account_number: "full-account-number-test",
                interest_rate: { percentage: 6.49, type: "fixed" },
                next_payment_amount: 284,
                next_payment_due_date: "2026-02-15",
                last_payment_amount: 284,
                last_payment_date: "2026-01-15",
                payoff_amount: 12345.67,
                maturity_date: "2029-03-15",
                principal_balance: 12000,
              },
            ],
            line_of_credit: [
              {
                account_id: "a5",
                interest_rate: null,
                aprs: [{ apr_percentage: 11.5, apr_type: "purchase_apr" }],
                minimum_payment_amount: 40,
                next_payment_amount: null,
                next_payment_due_date: "2026-02-20",
                last_payment_amount: null,
                last_payment_date: null,
                last_statement_balance: 900,
                last_statement_issue_date: "2026-01-25",
              },
            ],
          },
        },
      };
    }
    async investmentsHoldingsGet(b: Record<string, unknown>) {
      await this.rec("investmentsHoldingsGet", b);
      return {
        data: {
          accounts: [{ account_id: "a3" }],
          holdings: [
            { account_id: "a3", security_id: "s1", quantity: 2, institution_value: 20, cost_basis: null, institution_price_as_of: "2026-01-01" },
          ],
          securities: [{ security_id: "s1", name: "Fund", ticker_symbol: "FND", type: "etf", close_price: 10, close_price_as_of: "2026-01-01" }],
        },
      };
    }
    async webhookVerificationKeyGet(b: Record<string, unknown>) {
      await this.rec("webhookVerificationKeyGet", b);
      return { data: { key: { alg: "ES256", crv: "P-256", kid: "k1", kty: "EC", use: "sig", x: "x", y: "y", expired_at: null } } };
    }
    async itemRemove(b: Record<string, unknown>) {
      await this.rec("itemRemove", b);
      return { data: {} };
    }
  }
  return {
    PlaidApi,
    Configuration: class {},
    CountryCode: { Us: "US" },
    PlaidEnvironments: { sandbox: "https://sandbox.example.test", production: "https://prod.example.test" },
    Products: { Transactions: "transactions", Liabilities: "liabilities", Investments: "investments" },
  };
});

import { clientUserIdFor, createPlaidProvider, DAYS_REQUESTED } from "./sdk-provider";

const provider = () =>
  createPlaidProvider({
    clientId: "c",
    secret: "s",
    env: "sandbox",
    webhookUrl: "https://example.test/api/webhooks/plaid",
    redirectUri: null,
  });

beforeEach(() => {
  calls.length = 0;
  failWith = null;
});

describe("plaid sdk provider", () => {
  it("requests Transactions with 730 days and optional Liabilities and Investments", async () => {
    const r = await provider().createLinkToken({ ownerId: "owner-1" });
    expect(r.linkToken).toBe("link-test-token");
    const body = calls[0].body;
    expect(DAYS_REQUESTED).toBe(730);
    expect(body.products).toEqual(["transactions"]);
    expect(body.optional_products).toEqual(["liabilities", "investments"]);
    expect(body.transactions).toEqual({ days_requested: 730 });
    expect(body.webhook).toBe("https://example.test/api/webhooks/plaid");
    expect(body.user).toEqual({ client_user_id: clientUserIdFor("owner-1") });
    expect(body.access_token).toBeUndefined();
  });

  it("sends redirect_uri in new and update mode when configured, and omits it otherwise", async () => {
    const uri = "https://app.example.test/oauth/plaid";
    const withUri = createPlaidProvider({
      clientId: "c",
      secret: "s",
      env: "sandbox",
      webhookUrl: null,
      redirectUri: uri,
    });
    await withUri.createLinkToken({ ownerId: "o" });
    await withUri.createUpdateLinkToken({ ownerId: "o", accessToken: "access-x" });
    expect(calls[0].body.redirect_uri).toBe(uri);
    expect(calls[1].body.redirect_uri).toBe(uri);

    calls.length = 0;
    await provider().createLinkToken({ ownerId: "o" });
    await provider().createUpdateLinkToken({ ownerId: "o", accessToken: "access-x" });
    expect("redirect_uri" in calls[0].body).toBe(false);
    expect("redirect_uri" in calls[1].body).toBe(false);
  });

  it("derives the client_user_id from the owner id, not an email", () => {
    expect(clientUserIdFor("abc")).toBe("mmff-abc");
  });

  it("update mode passes the access token and no products", async () => {
    await provider().createUpdateLinkToken({ ownerId: "o", accessToken: "access-x" });
    const body = calls[0].body;
    expect(body.access_token).toBe("access-x");
    expect(body.products).toBeUndefined();
    expect(body.optional_products).toBeUndefined();
    expect(body.transactions).toBeUndefined();
  });

  it("reads item error codes and cached accounts via /accounts/get", async () => {
    const p = provider();
    expect((await p.getItem("t")).errorCode).toBe("ITEM_LOGIN_REQUIRED");
    const accts = await p.getAccounts("t");
    expect(accts[0]).toMatchObject({
      accountId: "a1",
      currentDollars: 10.5,
      availableDollars: null,
      mask: "0001",
    });
    expect(calls.map((c) => c.name)).toEqual(["itemGet", "accountsGet"]);
  });

  it("maps the sync, liabilities, holdings and webhook-key responses to neutral shapes", async () => {
    const p = provider();
    const sync = await p.transactionsSync("t", null);
    expect(calls[0].body).toMatchObject({ access_token: "t", count: 500 });
    expect(calls[0].body.cursor).toBeUndefined();
    expect(sync).toMatchObject({ nextCursor: "cur-2", hasMore: true });
    expect(sync.added[0]).toMatchObject({
      transactionId: "t1",
      amountDollars: 4.5,
      categoryPrimary: "FOOD_AND_DRINK",
      pendingTransactionId: "t1-pending",
    });
    expect(sync.removed).toEqual([{ transactionId: "t0", accountId: "a1" }]);
    await p.transactionsSync("t", "cur-2");
    expect(calls[1].body.cursor).toBe("cur-2");

    const liabs = await p.getLiabilities("t");
    expect(liabs).toHaveLength(3);
    expect(liabs[0]).toMatchObject({ accountId: "a2", aprPercentage: 24.99, aprType: "purchase_apr", minPaymentDollars: 25 });
    // An auto (or other closed-end) loan: the scheduled payment fills the
    // payment slot, and the payoff, end date and last payment come along.
    expect(liabs[1]).toEqual({
      accountId: "a4",
      kind: "loan",
      nextDueDate: "2026-02-15",
      minPaymentDollars: 284,
      lastStatementBalanceDollars: null,
      lastStatementDate: null,
      aprPercentage: 6.49,
      aprType: "fixed",
      payoffDollars: 12345.67,
      maturityDate: "2029-03-15",
      lastPaymentDollars: 284,
      lastPaymentDate: "2026-01-15",
    });
    expect(liabs[2]).toMatchObject({
      accountId: "a5",
      kind: "line_of_credit",
      minPaymentDollars: 40,
      aprPercentage: 11.5,
      lastStatementBalanceDollars: 900,
    });
    expect(JSON.stringify(liabs)).not.toContain("full-account-number-test");

    const inv = await p.getInvestmentsHoldings("t");
    expect(inv.accountIds).toEqual(["a3"]);
    expect(inv.holdings[0]).toMatchObject({ quantity: 2, institutionValueDollars: 20, costBasisDollars: null });
    expect(inv.securities[0]).toMatchObject({ ticker: "FND", closePriceDollars: 10 });

    const key = await p.getWebhookVerificationKey("k1");
    expect(key).toMatchObject({ kid: "k1", alg: "ES256", expiredAt: null });
    expect(calls.at(-1)?.body).toMatchObject({ key_id: "k1" });
  });

  it("normalises SDK failures", async () => {
    failWith = { response: { status: 400, data: { error_code: "ITEM_LOGIN_REQUIRED" } } };
    await expect(provider().removeItem("t")).rejects.toMatchObject({ code: "ITEM_LOGIN_REQUIRED" });
  });
});
