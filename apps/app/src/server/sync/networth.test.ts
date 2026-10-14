import { describe, expect, it } from "vitest";
import { computeNetWorth } from "./networth";

describe("computeNetWorth", () => {
  it("is assets minus the positive amounts owed", () => {
    const r = computeNetWorth([
      { isLiability: false, balanceCents: 100000 },
      { isLiability: false, balanceCents: 25050 },
      { isLiability: true, balanceCents: 40000 },
    ]);
    expect(r).toMatchObject({
      assetsCents: 125050,
      liabilitiesCents: 40000,
      netWorthCents: 85050,
      incomplete: false,
      countedAccounts: 3,
      excludedAccounts: 0,
    });
  });
  it("excludes unknown balances and flags the result incomplete, never as zero", () => {
    const r = computeNetWorth([
      { isLiability: false, balanceCents: 500 },
      { isLiability: false, balanceCents: null },
      { isLiability: true, balanceCents: null },
    ]);
    expect(r.assetsCents).toBe(500);
    expect(r.liabilitiesCents).toBe(0);
    expect(r.netWorthCents).toBe(500);
    expect(r.incomplete).toBe(true);
    expect(r.countedAccounts).toBe(1);
    expect(r.excludedAccounts).toBe(2);
  });
  it("counts a real zero balance as counted, not incomplete", () => {
    const r = computeNetWorth([{ isLiability: false, balanceCents: 0 }]);
    expect(r.incomplete).toBe(false);
    expect(r.countedAccounts).toBe(1);
  });
  it("can go negative and handles no accounts", () => {
    expect(computeNetWorth([{ isLiability: true, balanceCents: 900 }]).netWorthCents).toBe(-900);
    const none = computeNetWorth([]);
    expect(none.countedAccounts).toBe(0);
    expect(none.incomplete).toBe(false);
  });
  it("refuses sums beyond safe integers", () => {
    expect(() =>
      computeNetWorth([
        { isLiability: false, balanceCents: Number.MAX_SAFE_INTEGER },
        { isLiability: false, balanceCents: 10 },
      ]),
    ).toThrow(RangeError);
  });
});
