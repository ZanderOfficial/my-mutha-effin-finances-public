import { formatShortDate } from "@/lib/format";
import { formatBps } from "@/lib/invest";
import type { AllocationSlice } from "@/lib/invest";
import { formatCents } from "@/lib/money";
import { chartLine, chartSummary, rangeDelta, type NetWorthPoint } from "@/lib/networth";

function lineColour(series: NetWorthPoint[]): string {
  if (series.length < 2) return "#f5f5f5";
  return series[series.length - 1].netWorthCents >= series[0].netWorthCents ? "#39ff88" : "#ff2d55";
}

/**
 * Small net worth line for the Overview. Hand-built SVG, no chart library.
 * No data draws only a flat baseline; one sentence summarises the line.
 */
export function Sparkline({ series }: { series: NetWorthPoint[] }) {
  const line = chartLine(series, 240, 56, 4);
  const summary = chartSummary(series, rangeDelta(series));
  return (
    <svg viewBox="0 0 240 56" role="img" aria-label={summary} className="mt-4 block h-14 w-full" preserveAspectRatio="none">
      <title>{summary}</title>
      <line x1="4" y1="52" x2="236" y2="52" stroke="#2a2a2e" strokeWidth="1" />
      {line && (
        <path
          d={line.d}
          fill="none"
          stroke={lineColour(series)}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ filter: `drop-shadow(0 0 4px ${lineColour(series)}99)` }}
        />
      )}
    </svg>
  );
}

const W = 720;
const H = 240;

/**
 * The Net worth summary chart: a glowing line with a baseline and the first and
 * last dates in text. The <title> is the one-sentence text alternative. With
 * no data it shows the axes only.
 */
export function NetWorthChart({ series }: { series: NetWorthPoint[] }) {
  const line = chartLine(series, W, H, 12);
  const delta = rangeDelta(series);
  const summary = chartSummary(series, delta);
  const colour = lineColour(series);
  const first = series[0];
  const last = series[series.length - 1];
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        className="block h-auto w-full border border-rule bg-panel"
      >
        <title>{summary}</title>
        <line x1="12" y1={H - 12} x2={W - 12} y2={H - 12} stroke="#2a2a2e" strokeWidth="1" />
        <line x1="12" y1="12" x2="12" y2={H - 12} stroke="#2a2a2e" strokeWidth="1" />
        {line && (
          <path
            d={line.d}
            fill="none"
            stroke={colour}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: `drop-shadow(0 0 6px ${colour}b3)` }}
          />
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm text-muted">
        <span>{first ? formatShortDate(first.date, true) : "—"}</span>
        <span>{last && last !== first ? formatShortDate(last.date, true) : ""}</span>
      </figcaption>
      <p className="mt-1 text-sm text-muted">{summary}</p>
    </figure>
  );
}

// Greys, light to dark: the ring never leans on colour. The legend carries the words.
const SHADES = ["#f5f5f5", "#cfcfd4", "#a1a1a8", "#7c7c84", "#5a5a62", "#43434a"];

const R = 80;
const C = 2 * Math.PI * R;

/** Allocation ring: one arc per security type, with the same figures in the legend beside it. */
export function AllocationRing({ slices }: { slices: AllocationSlice[] }) {
  const summary = slices.length
    ? `Allocation by type: ${slices.map((s) => `${s.label} ${formatBps(s.shareBps)}`).join(", ")}.`
    : "No holdings yet.";
  const starts = slices.map((_, i) =>
    slices.slice(0, i).reduce((sum, s) => sum + (s.shareBps / 10000) * C, 0),
  );
  return (
    <div className="flex flex-wrap items-center gap-8">
      <svg viewBox="0 0 200 200" role="img" aria-label={summary} className="h-48 w-48 shrink-0">
        <title>{summary}</title>
        <circle cx="100" cy="100" r={R} fill="none" stroke="#2a2a2e" strokeWidth="26" />
        {slices.map((s, i) => {
          const length = (s.shareBps / 10000) * C;
          const gap = slices.length > 1 ? 2 : 0;
          return (
            <circle
              key={s.label}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={SHADES[Math.min(i, SHADES.length - 1)]}
              strokeWidth="26"
              strokeDasharray={`${Math.max(length - gap, 0)} ${C}`}
              strokeDashoffset={-starts[i]}
              transform="rotate(-90 100 100)"
            />
          );
        })}
      </svg>
      {slices.length > 0 && (
        <ul className="min-w-0 flex-1 basis-48 space-y-2">
          {slices.map((s, i) => (
            <li key={s.label} className="flex items-baseline gap-3 text-base">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 shrink-0 translate-y-px"
                style={{ background: SHADES[Math.min(i, SHADES.length - 1)] }}
              />
              <span className="flex-1">{s.label}</span>
              <span className="text-muted">{formatCents(s.valueCents)}</span>
              <span className="w-16 text-right font-semibold">{formatBps(s.shareBps)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
