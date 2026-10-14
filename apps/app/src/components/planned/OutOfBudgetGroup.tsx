"use client";
// The pinned last groups: spending kept off the plan, one-time spending (by the owner's kinds), transfers and charges marked not spending, each charge nested to move or unassign.

import { useState } from "react";
import { Money } from "@/components/Money";
import { CELL, GUTTER, NUM, STICKY_FIRST, TD } from "@/components/table/styles";
import { placementOf, type BudgetTransaction } from "@/lib/actuals";
import { cn } from "@/lib/cn";
import type { GroupTotal } from "@/lib/planned-budget";
import { AFTER_STANDING, plannedColumnCount } from "./columns";
import { ChargesButton } from "./ItemRow";
import { MatchRows } from "./MatchRows";
import { usePlanned } from "./PlannedContext";

/** Out of budget and one-time count in Spent; not spending is money that came back and counts nowhere. */
const KINDS = {
  out: { id: "out-of-budget-charges", name: "Out of budget", counts: "Counts in Spent", what: "Charges you chose to keep off the plan" },
  one_time: { id: "one-time-charges", name: "One-time", counts: "Counts in Spent", what: "Purchases you don’t expect to repeat" },
  not_spending: { id: "not-spending-charges", name: "Not spending", counts: "Counts nowhere", what: "Money that left and came back" },
  transfer: { id: "transfer-charges", name: "Transfers", counts: "Counts nowhere", what: "Money moved to your own accounts" },
} as const;

/** One row under a group: a one-time kind, its total and its charges. */
type Part = { key: string; name: string; cents: number; transactions: BudgetTransaction[] };

/** Each skipped column keeps its own cell, so a column hidden on a phone (Freq) hides here too. */
export function OutOfBudgetGroup({
  transactions,
  cents,
  kind = "out",
  byKind,
}: {
  transactions: BudgetTransaction[];
  cents: number;
  kind?: keyof typeof KINDS;
  /** One-time only: the totals by the owner's one-time kind, which become a row each under the group. */
  byKind?: GroupTotal[];
}) {
  const { period, oneTimeKinds } = usePlanned();
  const [open, setOpen] = useState(false);
  const words = KINDS[kind];
  const parts = byKind ? partsByKind(byKind, transactions, oneTimeKinds) : [];
  return (
    <tbody>
      <tr className="font-semibold [&>td]:border-t [&>td]:border-t-rule [&>td]:bg-panel [&>th]:border-t [&>th]:border-t-rule [&>th]:bg-panel">
        <th scope="row" className={cn(TD, STICKY_FIRST, GUTTER, "bg-panel text-left")}>
          {words.name}
        </th>
        <BlankFigures />
        <td className={`${CELL} whitespace-nowrap pl-2.5 pr-1 ${NUM}`}>
          <Money cents={cents} />
          {parts.length === 0 && (
            <ChargesButton count={transactions.length} name={words.name} open={open} controls={words.id} onToggle={() => setOpen((shown) => !shown)} />
          )}
        </td>
        <td className={`${TD} font-normal text-muted`}>{words.counts}</td>
        <td colSpan={AFTER_STANDING} className={`${TD} font-normal text-muted`}>
          {words.what}, {period === "annual" ? "this year so far" : "this month"}
        </td>
      </tr>
      {parts.length === 0 ? (
        <MatchRows id={words.id} colSpan={plannedColumnCount(period)} label={`Charges: ${words.name}`} transactions={transactions} hidden={!open} />
      ) : (
        parts.map((part) => <PartRows key={part.key} part={part} id={`${words.id}-${part.key}`} />)
      )}
    </tbody>
  );
}

/** Amount, Freq (hidden on a phone) and, in the Annual view, ×12: blank for a group with no plan. */
function BlankFigures() {
  const { period } = usePlanned();
  return (
    <>
      <td className={TD}>
        <span className="sr-only">No planned amount</span>
      </td>
      <td className={`${TD} max-md:hidden`} />
      {period === "annual" && <td className={TD} />}
    </>
  );
}

/** One kind under the group, indented like a sub-item, with its charges behind its count. */
function PartRows({ part, id }: { part: Part; id: string }) {
  const { period } = usePlanned();
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <th scope="row" className={cn(TD, STICKY_FIRST, GUTTER, "bg-background pl-8 text-left font-normal")}>
          {part.name}
        </th>
        <BlankFigures />
        <td className={`${CELL} whitespace-nowrap pl-2.5 pr-1 ${NUM}`}>
          <Money cents={part.cents} />
          <ChargesButton count={part.transactions.length} name={part.name} open={open} controls={id} onToggle={() => setOpen((shown) => !shown)} />
        </td>
        <td colSpan={AFTER_STANDING + 1} className={TD} />
      </tr>
      <MatchRows id={id} colSpan={plannedColumnCount(period)} label={`Charges: ${part.name}`} transactions={part.transactions} hidden={!open} />
    </>
  );
}

/** The totals by kind, biggest first, each with its charges; a charge with no kind named reads "No kind". */
function partsByKind(totals: GroupTotal[], transactions: BudgetTransaction[], kinds: { id: string; name: string }[]): Part[] {
  return totals.map(({ key, totalCents }) => ({
    key: key ?? "none",
    name: kinds.find((kind) => kind.id === key)?.name ?? "No kind",
    cents: totalCents,
    transactions: transactions.filter((t) => oneTimeKindOf(t) === key),
  }));
}

function oneTimeKindOf(t: BudgetTransaction): string | null {
  const placement = placementOf(t);
  return placement?.kind === "one_time" ? placement.oneTimeKindId : null;
}
