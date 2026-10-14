import { describe, expect, it } from "vitest";
import {
  DRY_LINES,
  depositStatus,
  dryLine,
  gapCents,
  gapSentence,
  isFlowExcluded,
  isOwnTransfer,
  spendingDelta,
} from "./flow";

describe("isOwnTransfer: a same-amount move between two of the owner's accounts within 3 days", () => {
  const row = (id: string, accountId: string, amountCents: number, date: string) => ({ id, accountId, amountCents, date });
  const deposit = row("in", "savings", 50000, "2026-10-10");
  const pairsWith = (other: ReturnType<typeof row>) => isOwnTransfer(deposit, [deposit, other]);

  it("pairs the same day and up to 3 days either side", () => {
    expect(pairsWith(row("out", "checking", -50000, "2026-10-10"))).toBe(true);
    expect(pairsWith(row("out", "checking", -50000, "2026-10-07"))).toBe(true);
    expect(pairsWith(row("out", "checking", -50000, "2026-10-13"))).toBe(true);
  });

  it("does not pair 4 days apart, a different amount, the same sign, or the same account", () => {
    expect(pairsWith(row("out", "checking", -50000, "2026-10-14"))).toBe(false);
    expect(pairsWith(row("out", "checking", -50001, "2026-10-10"))).toBe(false);
    expect(pairsWith(row("out", "checking", 50000, "2026-10-10"))).toBe(false);
    expect(pairsWith(row("out", "savings", -50000, "2026-10-10"))).toBe(false);
  });

  it("pairs across a month end", () => {
    expect(isOwnTransfer(row("in", "a", 100, "2026-11-01"), [row("out", "b", -100, "2026-10-30")])).toBe(true);
  });
});

describe("depositStatus with an own-account transfer", () => {
  const deposit = { amountCents: 1000, category: "INCOME", categoryDetail: null, choiceKind: null, ruleKind: "income", ownTransfer: true };
  it("is not income over a rule and Plaid's label, but the owner's own choice beats it", () => {
    expect(depositStatus(deposit)).toBe("not_income");
    expect(depositStatus({ ...deposit, choiceKind: "income" })).toBe("income");
    expect(depositStatus({ ...deposit, choiceKind: "planned_item" })).toBe("not_income");
  });
});

describe("depositStatus", () => {
  const deposit = {
    amountCents: 1000,
    category: "TRANSFER_IN",
    categoryDetail: "TRANSFER_IN_DEPOSIT",
    choiceKind: null,
    ruleKind: null,
  };

  it("leaves a deposit Plaid cannot classify for the owner to sort", () => {
    expect(depositStatus(deposit)).toBe("unsorted");
    expect(depositStatus({ ...deposit, category: "GENERAL_MERCHANDISE", categoryDetail: null })).toBe("unsorted");
  });

  it("counts Plaid's income label until the owner says otherwise", () => {
    expect(depositStatus({ ...deposit, category: "INCOME", categoryDetail: "INCOME_WAGES" })).toBe("income");
    expect(depositStatus({ ...deposit, category: "INCOME", ruleKind: "not_income" })).toBe("not_income");
  });

  it("follows the source rule, and a choice for the one deposit beats it", () => {
    expect(depositStatus({ ...deposit, ruleKind: "income" })).toBe("income");
    expect(depositStatus({ ...deposit, ruleKind: "income", choiceKind: "not_income" })).toBe("not_income");
  });

  it("never treats spending or a card payment credit as a deposit", () => {
    expect(depositStatus({ ...deposit, amountCents: -1000, ruleKind: "income" })).toBe("not_a_deposit");
    expect(depositStatus({ ...deposit, amountCents: 0 })).toBe("not_a_deposit");
    expect(
      depositStatus({ ...deposit, categoryDetail: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", choiceKind: "income" }),
    ).toBe("not_a_deposit");
  });
});

describe("isFlowExcluded", () => {
  it("excludes transfers and credit card payments", () => {
    expect(isFlowExcluded({ category: "TRANSFER_IN", categoryDetail: null })).toBe(true);
    expect(isFlowExcluded({ category: "TRANSFER_OUT", categoryDetail: "x" })).toBe(true);
    expect(
      isFlowExcluded({
        category: "LOAN_PAYMENTS",
        categoryDetail: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      }),
    ).toBe(true);
  });
  it("keeps other loan payments, ordinary categories and uncategorised rows", () => {
    expect(
      isFlowExcluded({ category: "LOAN_PAYMENTS", categoryDetail: "LOAN_PAYMENTS_CAR_PAYMENT" }),
    ).toBe(false);
    expect(isFlowExcluded({ category: "FOOD_AND_DRINK", categoryDetail: null })).toBe(false);
    expect(isFlowExcluded({ category: null, categoryDetail: null })).toBe(false);
  });
});

describe("gapCents", () => {
  it("is income minus spending, negative when overspent", () => {
    expect(gapCents(100000, 40000)).toBe(60000);
    expect(gapCents(100000, 141200)).toBe(-41200);
    expect(gapCents(0, 0)).toBe(0);
  });
  it("is unknown when either side is unknown", () => {
    expect(gapCents(null, 5)).toBeNull();
    expect(gapCents(5, null)).toBeNull();
  });
});

describe("gapSentence and dryLine", () => {
  it("states the true numbers", () => {
    expect(gapSentence(-41200, 17)).toBe("Over by $412 with 17 days left.");
    expect(gapSentence(12345, 1)).toBe("Ahead by $123.45 with 1 day left.");
    expect(gapSentence(0, 5)).toBe("Dead even with 5 days left.");
    expect(gapSentence(-100, 0)).toBe("Over by $1 on the last day of the month.");
  });
  it("says nothing when unknown", () => {
    expect(gapSentence(null, 5)).toBeNull();
    expect(dryLine(null, 5)).toBeNull();
  });
  it("only ever picks from the fixed phrase set for the state", () => {
    for (let day = 1; day <= 31; day++) {
      expect(DRY_LINES.over).toContain(dryLine(-1, day));
      expect(DRY_LINES.ahead).toContain(dryLine(1, day));
      expect(DRY_LINES.even).toContain(dryLine(0, day));
    }
    expect(Object.values(DRY_LINES).join(" ")).not.toMatch(/\d/);
  });
});

describe("spendingDelta", () => {
  it("compares with last month's same days", () => {
    expect(spendingDelta(5000, 3000)).toEqual({ diffCents: 2000, direction: "more" });
    expect(spendingDelta(1000, 3000)).toEqual({ diffCents: 2000, direction: "less" });
    expect(spendingDelta(3000, 3000)).toEqual({ diffCents: 0, direction: "same" });
  });
  it("is null with no comparison data", () => {
    expect(spendingDelta(5000, null)).toBeNull();
    expect(spendingDelta(null, 5000)).toBeNull();
  });
});
