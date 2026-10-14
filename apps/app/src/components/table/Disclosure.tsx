"use client";
// The ▸ that opens rows nested under a row, and the tabs that switch or filter a table's views in place.

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CELL_BUTTON } from "./styles";

/** ▸ turns to point down when open; aria-expanded and aria-controls say the same to a screen reader. */
export function ExpandButton({
  expanded,
  controls,
  label,
  onToggle,
  children,
  className,
}: {
  expanded: boolean;
  controls: string;
  /** Says what opens, e.g. "Sub-items of Software". Left out when `children` already say it. */
  label?: string;
  onToggle: () => void;
  /** Shown beside the ▸, e.g. a count of matched charges. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={children ? undefined : label}
      onClick={onToggle}
      className={cn(CELL_BUTTON, className)}
    >
      <span aria-hidden="true" className="chevron text-[12px]">
        ▸
      </span>
      {children}
    </button>
  );
}

export type Tab = { id: string; label: string; count?: number };

/**
 * Tabs over data the page already has. The one showing carries a 2px underline and aria-pressed,
 * never colour alone.
 */
export function ToggleTabs({ label, tabs, current, onChange }: { label: string; tabs: Tab[]; current: string; onChange: (id: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={tab.id === current}
          onClick={() => onChange(tab.id)}
          className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-[15px] font-semibold ${
            tab.id === current ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && <CountPill count={tab.count} />}
        </button>
      ))}
    </div>
  );
}

export type View = Tab & { content: ReactNode };

/**
 * Switches between views such as Sorting rules, One-offs and Businesses. Every view stays in the
 * page, hidden when not shown, so a row's inputs never leave its form.
 */
export function ViewSwitch({ label, views }: { label: string; views: View[] }) {
  const [current, setCurrent] = useState(views[0]?.id ?? "");
  return (
    <div>
      <div className="mb-2">
        <ToggleTabs label={label} tabs={views} current={current} onChange={setCurrent} />
      </div>
      {views.map((view) => (
        <div key={view.id} hidden={view.id !== current}>
          {view.content}
        </div>
      ))}
    </div>
  );
}

/** A small count beside a tab's name. */
export function CountPill({ count }: { count: number }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rule px-1.5 text-[12px] font-semibold text-foreground">
      {count}
    </span>
  );
}
