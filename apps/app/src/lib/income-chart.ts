// Geometry and words for the Income chart, worked out from one year of real monthly totals.
import { formatMonth } from "./format";
import { roundedMean, type IncomeMonth, type IncomeYear } from "./income";
import { formatCents } from "./money";

/** The SVG box. Each month gets one slot; heights are shares of the plot. */
export const CHART_BOX = { width: 1200, height: 400, slot: 100, bar: 56 } as const;

/** Chart colours from DESIGN.md. The contrast test checks each against the panel. */
export const CHART_COLOURS = {
  panel: "#111113",
  rule: "#2a2a2e",
  bar: "#39ff88",
  /** Opacity of an ordinary month's bar; the high and low months are drawn solid. */
  barOpacity: 0.55,
  trend: "#f5f5f5",
  average: "#a1a1a8",
} as const;

export type ChartBar = {
  month: string;
  kind: "complete" | "partial" | "unknown";
  totalCents: number | null;
  /** Height as a share of the plot, 0 to 1; null when the month is unknown. */
  share: number | null;
  mark: "high" | "low" | null;
};

export type IncomeChartModel = {
  bars: ChartBar[];
  /** Gridline values, bottom to top. Empty when nothing is known. */
  ticks: { cents: number; share: number }[];
  averageShare: number | null;
  /** A smoothed path through the three-month average; null with fewer than two complete months. */
  trendPath: string | null;
  summary: string;
};

const MIN_SCALE_CENTS = 10_000;
const NICE_STEPS = [1, 2, 2.5, 5, 10];

export function incomeChart(year: IncomeYear): IncomeChartModel {
  const scale = scaleFor(year);
  const bars = year.months.map((month) => toBar(month, year, scale));
  return {
    bars,
    ticks: scale === null ? [] : [0, scale / 2, scale].map((cents) => ({ cents, share: cents / scale })),
    averageShare: scale === null || year.averageCents === null ? null : year.averageCents / scale,
    trendPath: scale === null ? null : trendPath(year.months, scale),
    summary: chartSummary(year),
  };
}

/** "$2.5k" for an axis: whole dollars below $1,000, then thousands and millions, never rounded up. */
export function axisLabel(cents: number): string {
  const dollars = Math.floor(cents / 100);
  if (dollars < 1000) return `$${dollars}`;
  if (dollars < 1_000_000) return `$${tenths(dollars, 1000)}k`;
  return `$${tenths(dollars, 1_000_000)}M`;
}

function tenths(dollars: number, unit: number): string {
  const count = Math.floor(dollars / (unit / 10));
  const rest = count % 10;
  return rest === 0 ? `${Math.floor(count / 10)}` : `${Math.floor(count / 10)}.${rest}`;
}

/** The top of the scale: a round number at or above every known month and the average. */
function scaleFor(year: IncomeYear): number | null {
  const known = year.months.flatMap((m) => (m.totalCents === null ? [] : [m.totalCents]));
  if (known.length === 0) return null;
  const highest = Math.max(MIN_SCALE_CENTS, year.averageCents ?? 0, ...known);
  const power = 10 ** Math.floor(Math.log10(highest));
  const step = NICE_STEPS.find((s) => s * power >= highest) ?? 10;
  return step * power;
}

function toBar(month: IncomeMonth, year: IncomeYear, scale: number | null): ChartBar {
  const share = month.totalCents === null || scale === null ? null : Math.min(month.totalCents / scale, 1);
  return {
    month: month.month,
    kind: month.state === "complete" || month.state === "partial" ? month.state : "unknown",
    totalCents: month.totalCents,
    share,
    mark: monthMark(month.month, year),
  };
}

/** The year's high and low complete months, which the chart and the months table both mark; only when they differ. */
export function monthMark(month: string, year: IncomeYear): ChartBar["mark"] {
  if (year.highestMonth === year.lowestMonth) return null;
  if (month === year.highestMonth) return "high";
  if (month === year.lowestMonth) return "low";
  return null;
}

/** Each complete month's average with its complete neighbours, as integer cents. */
export function threeMonthAverages(months: IncomeMonth[]): { index: number; cents: number }[] {
  const completeTotal = (i: number) => (months[i]?.state === "complete" ? months[i].totalCents : null);
  return months.flatMap((_, index) => {
    if (completeTotal(index) === null) return [];
    const window = [index - 1, index, index + 1].flatMap((i) => completeTotal(i) ?? []);
    return [{ index, cents: roundedMean(window) }];
  });
}

function trendPath(months: IncomeMonth[], scale: number): string | null {
  const points = threeMonthAverages(months).map(({ index, cents }) => ({
    x: CHART_BOX.slot * (index + 0.5),
    y: CHART_BOX.height * (1 - Math.min(cents / scale, 1)),
  }));
  return points.length < 2 ? null : smoothPath(points);
}

/**
 * A curve through the points that never overshoots them (monotone cubic,
 * Fritsch and Carlson), so the trend never dips below zero or above a peak.
 */
export function smoothPath(points: { x: number; y: number }[]): string {
  const tangents = monotoneTangents(points);
  const start = `M${round(points[0].x)} ${round(points[0].y)}`;
  const curves = points.slice(1).map((end, i) => {
    const from = points[i];
    const third = (end.x - from.x) / 3;
    const c1 = `${round(from.x + third)} ${round(from.y + tangents[i] * third)}`;
    const c2 = `${round(end.x - third)} ${round(end.y - tangents[i + 1] * third)}`;
    return `C${c1} ${c2} ${round(end.x)} ${round(end.y)}`;
  });
  return [start, ...curves].join(" ");
}

function monotoneTangents(points: { x: number; y: number }[]): number[] {
  const slopes = points.slice(1).map((p, i) => (p.y - points[i].y) / (p.x - points[i].x));
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes[i - 1];
    return slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
  });

  // Flatten tangents that would make a segment overshoot.
  slopes.forEach((slope, i) => {
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      return;
    }
    const a = tangents[i] / slope;
    const b = tangents[i + 1] / slope;
    const length = Math.hypot(a, b);
    if (length <= 3) return;
    tangents[i] = (3 / length) * a * slope;
    tangents[i + 1] = (3 / length) * b * slope;
  });
  return tangents;
}

/** One plain sentence about the year, built only from real totals. */
export function chartSummary(year: IncomeYear): string {
  if (year.totalCents === null) return `No income history for ${year.year} yet.`;
  const money = (cents: number | null) => formatCents(cents, { trimZeroCents: true });
  const parts = [`Income in ${year.year}: ${money(year.totalCents)}.`];

  const high = year.months.find((m) => m.month === year.highestMonth);
  const low = year.months.find((m) => m.month === year.lowestMonth);
  if (high && low && high !== low) {
    parts.push(`Highest complete month ${formatMonth(high.month, true)}, ${money(high.totalCents)}.`);
    parts.push(`Lowest ${formatMonth(low.month, true)}, ${money(low.totalCents)}.`);
  }

  const completeCount = year.months.filter((m) => m.state === "complete").length;
  if (year.averageCents !== null) {
    parts.push(`Average ${money(year.averageCents)} a month over ${completeCount} complete ${completeCount === 1 ? "month" : "months"}.`);
  }

  const partial = year.months.filter((m) => m.state === "partial").map((m) => formatMonth(m.month, true));
  if (partial.length > 0) parts.push(`${partial.join(" and ")} ${partial.length === 1 ? "is" : "are"} partial.`);
  return parts.join(" ");
}

/** The words in the floating readout over a hovered bar: month, full total, and what kind of month it is. */
export function barReadout(bar: ChartBar): { month: string; amount: string; note: string | null } {
  const month = `${formatMonth(bar.month, true)} ${bar.month.slice(0, 4)}`;
  return { month, amount: formatCents(bar.totalCents), note: readoutNote(bar) };
}

function readoutNote(bar: ChartBar): string | null {
  if (bar.totalCents === null) return "No data";
  if (bar.kind === "partial") return "So far";
  if (bar.mark === "high") return "Highest complete month";
  if (bar.mark === "low") return "Lowest complete month";
  return null;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
