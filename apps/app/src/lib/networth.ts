import { formatCents } from "./money";
import { addMonthsClamped } from "./month";

export const RANGES = ["1M", "6M", "1Y", "All"] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = "6M";

export function parseRange(value: string | string[] | undefined): Range {
  const v = Array.isArray(value) ? value[0] : value;
  return (RANGES as readonly string[]).includes(v ?? "") ? (v as Range) : DEFAULT_RANGE;
}

/** The first date included in `range` (inclusive), or null for All. */
export function rangeStartDate(today: string, range: Range): string | null {
  switch (range) {
    case "1M":
      return addMonthsClamped(today, -1);
    case "6M":
      return addMonthsClamped(today, -6);
    case "1Y":
      return addMonthsClamped(today, -12);
    case "All":
      return null;
  }
}

export type NetWorthPoint = { date: string; netWorthCents: number };

export type RangeDelta = {
  fromDate: string;
  toDate: string;
  fromCents: number;
  toCents: number;
  deltaCents: number;
};

/**
 * Change between the first and last point in the series (assumed oldest
 * first). Needs two points: one point is a level, not a change, so the answer
 * is null rather than a made-up zero.
 */
export function rangeDelta(series: NetWorthPoint[]): RangeDelta | null {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  return {
    fromDate: first.date,
    toDate: last.date,
    fromCents: first.netWorthCents,
    toCents: last.netWorthCents,
    deltaCents: last.netWorthCents - first.netWorthCents,
  };
}

export type ChartLine = {
  /** SVG path data. A single point is a zero-length move so a round cap draws a dot. */
  d: string;
  last: { x: number; y: number };
};

/**
 * Maps a series to SVG coordinates inside width x height with `pad` on each
 * side. X is by calendar day (a gap in snapshots shows as a gap, not as evenly
 * spaced points). Y is scaled to the series' own min and max; a flat series
 * sits mid-height. These are drawing coordinates, not money, so floats are
 * fine. Null for an empty series.
 */
export function chartLine(
  series: NetWorthPoint[],
  width: number,
  height: number,
  pad: number,
): ChartLine | null {
  if (series.length === 0) return null;
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const t0 = day(series[0].date);
  const t1 = day(series[series.length - 1].date);
  const values = series.map((p) => p.netWorthCents);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const w = width - pad * 2;
  const h = height - pad * 2;
  const pts = series.map((p) => {
    const x = t1 === t0 ? pad + w / 2 : pad + ((day(p.date) - t0) / (t1 - t0)) * w;
    const y = hi === lo ? pad + h / 2 : pad + (1 - (p.netWorthCents - lo) / (hi - lo)) * h;
    return { x: round(x), y: round(y) };
  });
  const d =
    pts.length === 1
      ? `M${pts[0].x} ${pts[0].y}h0`
      : pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return { d, last: pts[pts.length - 1] };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** One plain sentence that says what the chart shows. Never invents a figure. */
export function chartSummary(series: NetWorthPoint[], delta: RangeDelta | null): string {
  if (series.length === 0) return "No net worth history yet.";
  const last = series[series.length - 1];
  if (!delta) {
    return `Net worth was ${formatCents(last.netWorthCents)} on ${last.date}. One day of history so far.`;
  }
  const change = formatCents(delta.deltaCents, { sign: true });
  return `Net worth went from ${formatCents(delta.fromCents)} on ${delta.fromDate} to ${formatCents(delta.toCents)} on ${delta.toDate}, a change of ${change}.`;
}

export type AccountBalance = {
  isLiability: boolean;
  balanceCents: number | null;
};

/** Splits accounts into the asset list and the liability list (positive amount owed). */
export function splitAccounts<T extends AccountBalance>(
  accounts: T[],
): { assets: T[]; liabilities: T[] } {
  return {
    assets: accounts.filter((a) => !a.isLiability),
    liabilities: accounts.filter((a) => a.isLiability),
  };
}
