export type NetWorthAccount = {
  isLiability: boolean;
  /** Stored balance: liabilities carry the positive amount owed. Null is unknown. */
  balanceCents: number | null;
};

export type NetWorth = {
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  /** True when any account had an unknown balance and was left out. */
  incomplete: boolean;
  countedAccounts: number;
  excludedAccounts: number;
};

function add(a: number, b: number): number {
  const n = a + b;
  if (!Number.isSafeInteger(n)) throw new RangeError("Net worth does not fit in safe integer cents");
  return n;
}

/**
 * Net worth from account balances only. Assets are the sum of non-liability
 * balances, liabilities the sum of liability balances (positive amounts owed),
 * net is assets minus liabilities. Investment holdings are NOT added: an
 * investment account's balance already includes them. An account with an
 * unknown (null) balance is excluded and sets `incomplete`; it is never
 * counted as zero.
 */
export function computeNetWorth(accounts: readonly NetWorthAccount[]): NetWorth {
  let assets = 0;
  let liabilities = 0;
  let counted = 0;
  let excluded = 0;
  for (const a of accounts) {
    if (a.balanceCents === null) {
      excluded += 1;
      continue;
    }
    counted += 1;
    if (a.isLiability) liabilities = add(liabilities, a.balanceCents);
    else assets = add(assets, a.balanceCents);
  }
  return {
    assetsCents: assets,
    liabilitiesCents: liabilities,
    netWorthCents: add(assets, -liabilities),
    incomplete: excluded > 0,
    countedAccounts: counted,
    excludedAccounts: excluded,
  };
}
