// The Budget tables' frame and read-only cells, usable from server and client components alike.
import type { ReactNode } from "react";
import { Money } from "@/components/Money";
import { cn } from "@/lib/cn";
import type { StateWords } from "@/lib/budget-table";
import { ScrollBox } from "./ScrollBox";
import { CLEAR_STICKY, NUM, TD, TH } from "./styles";

/** The aria-hidden type mark in each header: the column's kind at a glance, never its only label. */
const GLYPHS = {
  text: "Aa",
  money: "$",
  select: "▾",
  tags: "⊞",
  status: "●",
  relation: "↗",
  computed: "Σ",
  date: "◷",
  count: "#",
  check: "☑",
  alert: "!",
} as const;

export type ColumnKind = keyof typeof GLYPHS;

/**
 * Below which width a table scrolls sideways: a phone, or for the widest table anything under a
 * full laptop screen. Each holds the classes that show the hint and fade, and that leave room past
 * the last column so the fade never sits on it once scrolled to the end.
 */
const SCROLLS = {
  phone: { shown: "md:hidden", room: "max-md:pr-7" },
  laptop: { shown: "min-[1240px]:hidden", room: "max-[1239px]:pr-7" },
} as const;

/**
 * A real table in a bordered box. A table wider than the screen scrolls sideways inside the box,
 * with a line above it naming what is off to the right, a fade at the right edge, and a focusable
 * box so the keyboard can scroll it. Tab never leaves a cell hidden under the sticky first column.
 */
export function DataTable({
  label,
  minWidth,
  scrolls = "phone",
  hint = "more columns",
  children,
}: {
  /** Names the table for screen readers. */
  label: string;
  /** A Tailwind min-width class, such as "min-w-[1080px]"; set only when the table can be wider than the screen. */
  minWidth?: string;
  scrolls?: keyof typeof SCROLLS;
  /** What scrolling sideways shows, e.g. "For, Tax category, Status and Notes". */
  hint?: string;
  children: ReactNode;
}) {
  const widths = SCROLLS[scrolls];
  const scroller = minWidth ? { tabIndex: 0, role: "region", "aria-label": label } : {};
  return (
    <div>
      {minWidth && (
        <p className={`mb-2 text-[13px] text-muted ${widths.shown}`}>
          <span aria-hidden="true">⇆ </span>Scroll sideways for {hint}
        </p>
      )}
      <div className="relative rounded-md border border-rule">
        <ScrollBox
          {...scroller}
          className={cn("overflow-x-auto rounded-md [scrollbar-color:var(--color-rule)_transparent]", minWidth && [widths.room, CLEAR_STICKY])}
        >
          <table className={`w-full border-separate border-spacing-0 text-[14px] ${minWidth ?? ""}`}>
            <caption className="sr-only">{label}</caption>
            {children}
          </table>
        </ScrollBox>
        {minWidth && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 right-0 w-7 rounded-r-md bg-gradient-to-l from-background ${widths.shown}`}
          />
        )}
      </div>
    </div>
  );
}

/** A header cell with its type mark. `srOnly` keeps the column's name for screen readers only. */
export function Column({
  kind,
  children,
  end,
  srOnly,
  className,
}: {
  kind?: ColumnKind;
  children: ReactNode;
  /** Right-aligned, for money and counts. */
  end?: boolean;
  srOnly?: boolean;
  className?: string;
}) {
  return (
    <th scope="col" className={cn(TH, end && "text-right", className)}>
      {kind && !srOnly && (
        <span aria-hidden="true" className="mr-1.5 font-medium">
          {GLYPHS[kind]}
        </span>
      )}
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

/** The one row an empty table shows. No example figures, ever. */
export function EmptyRow({ colSpan, children = "Nothing here yet." }: { colSpan: number; children?: ReactNode }) {
  return (
    <tbody>
      <tr>
        <td colSpan={colSpan} className={`${TD} text-muted`}>
          {children}
        </td>
      </tr>
    </tbody>
  );
}

/** A read-only money cell: a dash when unknown, $0.00 only for a real zero. */
export function MoneyCell({ cents, className }: { cents: number | null; className?: string }) {
  return (
    <td className={cn(TD, NUM, cents === null && "text-muted", className)}>
      <Money cents={cents} />
    </td>
  );
}

const TONES: Record<StateWords["tone"], string> = {
  income: "text-income",
  spending: "text-spending",
  plain: "text-foreground",
  muted: "text-muted",
};

/** A state as glyph and words; colour only ever repeats what the words say. */
export function StateText({ state, className }: { state: StateWords; className?: string }) {
  return (
    <span className={cn(TONES[state.tone], state.tone !== "plain" && state.tone !== "muted" && "font-semibold", className)}>
      {state.glyph && <span aria-hidden="true">{state.glyph} </span>}
      {state.words}
    </span>
  );
}
