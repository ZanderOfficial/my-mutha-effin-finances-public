import { describe, expect, it } from "vitest";
import { loanFacts, paymentLabel } from "./debts";

const none = {
  aprBps: null,
  aprType: null,
  payoffCents: null,
  maturityDate: null,
  lastPaymentCents: null,
  lastPaymentDate: null,
};

describe("loanFacts", () => {
  it("lists every known fact of a loan, in a fixed order", () => {
    expect(
      loanFacts({
        aprBps: 649,
        aprType: "fixed",
        payoffCents: 1234567,
        maturityDate: "2029-03-15",
        lastPaymentCents: 28400,
        lastPaymentDate: "2026-01-15",
      }),
    ).toEqual([
      "6.49% fixed rate",
      "payoff $12,345.67",
      "ends Mar 15, 2029",
      "last paid $284.00 on Jan 15",
    ]);
  });

  it("leaves out what is unknown instead of showing zero", () => {
    expect(loanFacts(none)).toEqual([]);
    expect(loanFacts({ ...none, payoffCents: 0 })).toEqual(["payoff $0.00"]);
    expect(loanFacts({ ...none, lastPaymentCents: 28400 })).toEqual(["last paid $284.00"]);
  });

  it("names only fixed or variable rates, not card APR codes", () => {
    expect(loanFacts({ ...none, aprBps: 1150, aprType: "purchase_apr" })).toEqual(["11.50% rate"]);
    expect(loanFacts({ ...none, aprBps: 500, aprType: "variable" })).toEqual(["5.00% variable rate"]);
  });
});

describe("paymentLabel", () => {
  it("calls a loan's scheduled amount a payment and a card's a minimum", () => {
    expect(paymentLabel("loan")).toBe("payment");
    expect(paymentLabel("credit")).toBe("minimum");
    expect(paymentLabel(null)).toBe("minimum");
  });
});
