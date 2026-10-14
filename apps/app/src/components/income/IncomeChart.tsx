// The Income chart: a bar per month, the trend, the average and the high and low months, drawn by hand in SVG.
import { formatMonth } from "@/lib/format";
import { CHART_BOX, CHART_COLOURS, axisLabel, incomeChart, type ChartBar, type IncomeChartModel } from "@/lib/income-chart";
import type { IncomeYear } from "@/lib/income";
import { formatCents } from "@/lib/money";
import { ChartHover } from "./ChartHover";

const { width: W, height: H, slot: SLOT, bar: BAR } = CHART_BOX;
const C = CHART_COLOURS;
const STRIPES = "income-partial-stripes";
const GLOW = "drop-shadow(0 0 6px rgb(57 255 136 / 0.55))";

/**
 * The drawing is hidden from screen readers: the caption says what it shows,
 * and the month table below it is the full text alternative.
 */
export function IncomeChart({ year }: { year: IncomeYear }) {
  const chart = incomeChart(year);
  return (
    <figure className="mb-4 rounded-md border border-rule bg-panel px-4 pb-4 pt-2 sm:px-5">
      <div aria-hidden="true">
        <div className="relative ml-12 mt-10 h-48 sm:h-64 lg:h-72">
          <YAxis ticks={chart.ticks} />
          <Plot chart={chart} />
          <Overlays bars={chart.bars} />
          {chart.ticks.length > 0 && <ChartHover bars={chart.bars} />}
        </div>
        <ol className="ml-12 mt-2 grid grid-cols-12 text-center text-xs text-muted">
          {chart.bars.map((bar) => (
            <li key={bar.month}>
              <span className="sm:hidden">{formatMonth(bar.month).charAt(0)}</span>
              <span className="hidden sm:inline">{formatMonth(bar.month)}</span>
            </li>
          ))}
        </ol>
        {chart.ticks.length > 0 && <Legend chart={chart} averageCents={year.averageCents} />}
      </div>
      <figcaption className="mt-3 text-sm text-muted">{chart.summary}</figcaption>
    </figure>
  );
}

function YAxis({ ticks }: { ticks: IncomeChartModel["ticks"] }) {
  return (
    <>
      {ticks.map((tick) => (
        <span
          key={tick.cents}
          className="absolute right-full mr-2 translate-y-1/2 text-xs text-muted"
          style={{ bottom: `${tick.share * 100}%` }}
        >
          {axisLabel(tick.cents)}
        </span>
      ))}
    </>
  );
}

function Plot({ chart }: { chart: IncomeChartModel }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <pattern id={STRIPES} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="16" fill={C.bar} fillOpacity={C.barOpacity} />
        </pattern>
      </defs>
      {chart.ticks.map((tick) => (
        <HorizontalLine key={tick.cents} share={tick.share} stroke={C.rule} width={1} />
      ))}
      <HorizontalLine share={0} stroke={C.rule} width={2} />
      {chart.bars.map((bar, index) => (
        <Bar key={bar.month} bar={bar} index={index} />
      ))}
      {chart.averageShare !== null && <HorizontalLine share={chart.averageShare} stroke={C.average} width={2} dashed />}
      {chart.trendPath && <TrendLine d={chart.trendPath} />}
    </svg>
  );
}

/** One month's bar. A real zero is a tick on the baseline; an unknown month draws nothing. */
function Bar({ bar, index }: { bar: ChartBar; index: number }) {
  if (bar.share === null) return null;
  const x = SLOT * index + (SLOT - BAR) / 2;
  const top = H * (1 - bar.share);
  if (bar.share === 0) {
    return <line x1={x} x2={x + BAR} y1={H} y2={H} stroke={C.bar} strokeWidth={3} vectorEffect="non-scaling-stroke" />;
  }
  if (bar.kind === "partial") {
    return (
      <rect
        x={x}
        y={top}
        width={BAR}
        height={H - top}
        fill={`url(#${STRIPES})`}
        stroke={C.bar}
        strokeWidth={2}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  const marked = bar.mark !== null;
  return (
    <rect
      x={x}
      y={top}
      width={BAR}
      height={H - top}
      fill={C.bar}
      fillOpacity={marked ? 1 : C.barOpacity}
      style={marked ? { filter: GLOW } : undefined}
    />
  );
}

/** A full-width line with a dark halo, so it stays readable where it crosses a bright bar. */
function HorizontalLine({ share, stroke, width, dashed }: { share: number; stroke: string; width: number; dashed?: boolean }) {
  const y = H * (1 - share);
  const line = { x1: 0, x2: W, y1: y, y2: y, vectorEffect: "non-scaling-stroke" } as const;
  if (!dashed) return <line {...line} stroke={stroke} strokeWidth={width} />;
  return (
    <>
      <line {...line} stroke={C.panel} strokeWidth={width + 4} />
      <line {...line} stroke={stroke} strokeWidth={width} strokeDasharray="8 6" />
    </>
  );
}

function TrendLine({ d }: { d: string }) {
  const path = { d, fill: "none", strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" } as const;
  return (
    <>
      <path {...path} stroke={C.panel} strokeWidth={7} />
      <path {...path} stroke={C.trend} strokeWidth={2.5} />
    </>
  );
}

/** Words drawn over the plot: "High" and "Low" above their bars, a dash for an unknown month. */
function Overlays({ bars }: { bars: ChartBar[] }) {
  return (
    <>
      {bars.map((bar, index) => {
        const left = `${((index + 0.5) / bars.length) * 100}%`;
        if (bar.share === null) {
          return (
            <span key={bar.month} className="absolute bottom-1 -translate-x-1/2 text-sm text-muted" style={{ left }}>
              —
            </span>
          );
        }
        if (bar.mark === null || bar.totalCents === null) return null;
        return (
          <span
            key={bar.month}
            className="absolute mb-1 -translate-x-1/2 whitespace-nowrap text-center text-xs font-bold leading-tight text-income"
            style={{ left, bottom: `${bar.share * 100}%` }}
          >
            {bar.mark === "high" ? "High" : "Low"}
            <br />
            {axisLabel(bar.totalCents)}
          </span>
        );
      })}
    </>
  );
}

function Legend({ chart, averageCents }: { chart: IncomeChartModel; averageCents: number | null }) {
  const hasMarks = chart.bars.some((b) => b.mark !== null);
  const hasPartial = chart.bars.some((b) => b.kind === "partial" && b.share !== null);
  return (
    <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
      <LegendItem swatch={<rect width="16" height="12" fill={C.bar} fillOpacity={C.barOpacity} />}>Month</LegendItem>
      {hasMarks && (
        <LegendItem swatch={<rect width="16" height="12" fill={C.bar} />}>Highest and lowest complete months</LegendItem>
      )}
      {hasPartial && (
        <LegendItem swatch={<rect width="15" height="11" x="0.5" y="0.5" fill={`url(#${STRIPES})`} stroke={C.bar} strokeDasharray="3 2" />}>
          Partial month, so far
        </LegendItem>
      )}
      {chart.trendPath && (
        <LegendItem swatch={<line x1="0" x2="16" y1="6" y2="6" stroke={C.trend} strokeWidth="2.5" />}>
          Trend, three-month average
        </LegendItem>
      )}
      {chart.averageShare !== null && (
        <LegendItem swatch={<line x1="0" x2="16" y1="6" y2="6" stroke={C.average} strokeWidth="2" strokeDasharray="4 3" />}>
          Average, {formatCents(averageCents, { trimZeroCents: true })} a month
        </LegendItem>
      )}
    </ul>
  );
}

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-2">
      <svg viewBox="0 0 16 12" className="h-3 w-4 shrink-0">
        {swatch}
      </svg>
      {children}
    </li>
  );
}
