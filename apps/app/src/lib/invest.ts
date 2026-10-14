/**
 * Splits 10000 basis points across positive known values by largest
 * remainder, so the shares always sum to exactly 10000 (no 99.99 percent
 * rings). Unknown (null) and non-positive values get a null share: they are
 * not part of the whole. With nothing positive every share is null.
 */
export function allocateBps(values: (number | null)[]): (number | null)[] {
  const ZERO = BigInt(0);
  const ONE = BigInt(1);
  const TEN_K = BigInt(10000);
  const positive = values.map((v) => (v !== null && v > 0 ? BigInt(v) : ZERO));
  const total = positive.reduce((a, b) => a + b, ZERO);
  if (total === ZERO) return values.map(() => null);

  const floors = positive.map((v) => (v * TEN_K) / total);
  const remainders = positive.map((v, i) => ({ i, r: (v * TEN_K) % total }));
  let left = TEN_K - floors.reduce((a, b) => a + b, ZERO);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const bonus = new Set<number>();
  for (const { i } of remainders) {
    if (left <= ZERO) break;
    if (positive[i] > ZERO) {
      bonus.add(i);
      left -= ONE;
    }
  }
  return values.map((v, i) =>
    v !== null && v > 0 ? Number(floors[i]) + (bonus.has(i) ? 1 : 0) : null,
  );
}

export type Holding = {
  name: string;
  ticker: string | null;
  securityType: string | null;
  accountName: string;
  valueCents: number | null;
};

export type HoldingRow = Holding & { shareBps: number | null };

/** Holdings with their share of the known total, biggest first, unknown values last. */
export function withShares(holdings: Holding[]): HoldingRow[] {
  const shares = allocateBps(holdings.map((h) => h.valueCents));
  return holdings
    .map((h, i) => ({ ...h, shareBps: shares[i] }))
    .sort(
      (a, b) =>
        (b.valueCents ?? Number.NEGATIVE_INFINITY) - (a.valueCents ?? Number.NEGATIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    );
}

export type AllocationSlice = { label: string; valueCents: number; shareBps: number };

/** Ring slices by security type (equity, etf, ...). Null type groups as "Other". */
export function allocationByType(holdings: Holding[]): AllocationSlice[] {
  const totals = new Map<string, number>();
  for (const h of holdings) {
    if (h.valueCents === null || h.valueCents <= 0) continue;
    const label = typeLabel(h.securityType);
    totals.set(label, (totals.get(label) ?? 0) + h.valueCents);
  }
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shares = allocateBps(entries.map(([, v]) => v));
  return entries.map(([label, valueCents], i) => ({
    label,
    valueCents,
    shareBps: shares[i] ?? 0,
  }));
}

export function typeLabel(type: string | null): string {
  const t = type?.trim().toLowerCase();
  if (!t) return "Other";
  if (t === "etf") return "ETF";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "12.34%" from basis points. Null is an em dash. */
export function formatBps(bps: number | null): string {
  if (bps === null) return "—";
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}%`;
}
