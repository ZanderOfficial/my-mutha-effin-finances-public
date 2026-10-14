import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  it("treats a missing status as a connection problem", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"), "sign-in")).toMatch(/connection/);
    expect(authErrorMessage(undefined, "sign-in")).toMatch(/connection/);
  });

  it("says wrong credentials for a 401 on sign-in, in both shapes", () => {
    expect(authErrorMessage({ status: 401 }, "sign-in")).toMatch(/do not match/);
    expect(authErrorMessage({ error: { status: 401 } }, "sign-in")).toMatch(/do not match/);
  });

  it("says the code failed for a bad reset", () => {
    expect(authErrorMessage({ status: 400 }, "reset")).toMatch(/code/);
  });

  it("points at the Neon settings for a 400 on sign-in", () => {
    expect(authErrorMessage({ status: 400 }, "sign-in")).toMatch(/Auth settings/);
  });

  it("handles rate limits and server errors", () => {
    expect(authErrorMessage({ status: 429 }, "send-code")).toMatch(/Too many/);
    expect(authErrorMessage({ status: 500 }, "sign-in")).toMatch(/Something went wrong/);
  });

  it("never echoes the input", () => {
    const msg = authErrorMessage({ status: 401, message: "secret-value" }, "sign-in");
    expect(msg).not.toContain("secret-value");
  });
});
