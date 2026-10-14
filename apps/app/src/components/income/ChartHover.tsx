"use client";
// Hover a month on the Income chart (or tap it on a phone) to float its total above the bar.

import { useState } from "react";
import { barReadout, type ChartBar } from "@/lib/income-chart";
import { cn } from "@/lib/cn";

/** Room above the bar's top, so the readout clears the "High" and "Low" words drawn there. */
const LIFT = "2.75rem";
/** The readout's height with a note; a tall bar's readout stops here so it never leaves the plot. */
const READOUT_HEIGHT = "5.5rem";

/**
 * One invisible column per month over the plot. It lives inside the chart's
 * aria-hidden wrapper: the month table below is the text alternative, so the
 * columns are pointer-only and never take focus.
 */
export function ChartHover({ bars }: { bars: ChartBar[] }) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="absolute inset-0 z-10 grid" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }} onPointerLeave={() => setActive(null)}>
      {bars.map((bar, index) => (
        <div
          key={bar.month}
          className={cn("h-full rounded-sm transition-colors duration-150", active === index && "bg-foreground/5")}
          onPointerEnter={(event) => event.pointerType === "mouse" && setActive(index)}
          onPointerDown={(event) => event.pointerType !== "mouse" && setActive((current) => (current === index ? null : index))}
        />
      ))}
      {active !== null && <Readout key={active} bar={bars[active]} index={active} count={bars.length} />}
    </div>
  );
}

/** The floating chip: month, full total, and a note for high, low, partial or unknown months. */
function Readout({ bar, index, count }: { bar: ChartBar; index: number; count: number }) {
  const words = barReadout(bar);
  const placement = edgePlacement(index, count);

  return (
    <div
      className={cn("readout-in pointer-events-none absolute whitespace-nowrap", placement.className)}
      style={{ left: `${((index + 0.5) / count) * 100}%`, bottom: `min(calc(${(bar.share ?? 0) * 100}% + ${LIFT}), calc(100% - ${READOUT_HEIGHT}))` }}
    >
      <div className="rounded-md border border-rule bg-panel-raised px-3 py-2 shadow-[0_8px_24px_rgb(0_0_0/0.6)]">
        <div className="text-xs font-semibold text-muted">{words.month}</div>
        <div className={cn("font-display text-3xl font-black leading-none tabular-nums", bar.totalCents === null ? "text-muted" : "glow-income text-income")}>
          {words.amount}
        </div>
        {words.note && <div className="mt-1 text-xs text-muted">{words.note}</div>}
      </div>
      <span className={cn("absolute top-full block h-2 w-2 -translate-y-1 rotate-45 border-b border-r border-rule bg-panel-raised", placement.caret)} />
    </div>
  );
}

/** Centre the chip over its bar, except at the edges, where it hangs inward so it is never cut off. */
function edgePlacement(index: number, count: number): { className: string; caret: string } {
  if (index === 0) return { className: "-translate-x-6", caret: "left-5" };
  if (index === count - 1) return { className: "-translate-x-[calc(100%-1.5rem)]", caret: "right-5" };
  return { className: "-translate-x-1/2", caret: "left-1/2 -translate-x-1/2" };
}
