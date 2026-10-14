import { describe, expect, it } from "vitest";
import { normalisePlaidError, PlaidApiError } from "./errors";

describe("normalisePlaidError", () => {
  it("detects ITEM_LOGIN_REQUIRED from an Axios-shaped error", () => {
    const err = normalisePlaidError({
      response: {
        status: 400,
        data: {
          error_type: "ITEM_ERROR",
          error_code: "ITEM_LOGIN_REQUIRED",
          display_message: "Contains Some Bank Name",
          error_message: "secret detail",
        },
      },
    });
    expect(err).toBeInstanceOf(PlaidApiError);
    expect(err.code).toBe("ITEM_LOGIN_REQUIRED");
    expect(err.isLoginRequired).toBe(true);
    expect(err.status).toBe(400);
  });

  it("uses our own safe message, never the response text", () => {
    const err = normalisePlaidError({
      response: { status: 400, data: { error_code: "SOMETHING_ELSE", error_message: "leaky text" } },
    });
    expect(err.message).toBe("Plaid could not complete the request.");
    expect(JSON.stringify(err)).not.toContain("leaky");
  });

  it("maps 429 and network failures and unknowns", () => {
    expect(normalisePlaidError({ response: { status: 429, data: {} } }).code).toBe("RATE_LIMIT");
    expect(normalisePlaidError({ code: "ECONNRESET" }).code).toBe("NETWORK");
    expect(normalisePlaidError(new Error("boom")).code).toBe("UNKNOWN");
    expect(normalisePlaidError("nope").isLoginRequired).toBe(false);
  });

  it("names the rejected field for INVALID_FIELD without keeping Plaid's text", () => {
    const redirect = normalisePlaidError({
      response: { status: 400, data: { error_code: "INVALID_FIELD", error_message: "OAuth redirect URI must be configured" } },
    });
    expect(redirect.code).toBe("INVALID_FIELD_REDIRECT_URI");
    expect(redirect.message).toMatch(/Allowed redirect URIs/);
    expect(JSON.stringify(redirect)).not.toContain("must be configured");

    const webhook = normalisePlaidError({
      response: { status: 400, data: { error_code: "INVALID_FIELD", error_message: "webhook must be a valid url" } },
    });
    expect(webhook.code).toBe("INVALID_FIELD_WEBHOOK");

    const other = normalisePlaidError({
      response: { status: 400, data: { error_code: "INVALID_FIELD", error_message: "client_name is too long" } },
    });
    expect(other.code).toBe("INVALID_FIELD");
    expect(other.message).toBe("Plaid rejected one of the link settings.");
  });

  it("explains rejected API keys", () => {
    const keys = normalisePlaidError({ response: { status: 400, data: { error_code: "INVALID_API_KEYS" } } });
    expect(keys.message).toMatch(/PLAID_CLIENT_ID/);
  });

  it("explains a Link customization missing its use case", () => {
    const custom = normalisePlaidError({
      response: { status: 400, data: { error_code: "INVALID_LINK_CUSTOMIZATION" } },
    });
    expect(custom.code).toBe("INVALID_LINK_CUSTOMIZATION");
    expect(custom.message).toMatch(/Data Transparency/);
  });

  it("passes an existing PlaidApiError through", () => {
    const e = new PlaidApiError("ITEM_NOT_FOUND");
    expect(normalisePlaidError(e)).toBe(e);
  });
});
