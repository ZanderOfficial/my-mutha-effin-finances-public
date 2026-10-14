"use client";
// Every expense in the period on the Expenses tab, each matchable to any Ledger item from its own row.

import { useState } from "react";
import { Money } from "@/components/Money";
import { Column, DataTable, EmptyRow } from "@/components/table/DataTable";
import { CELL_BUTTON, CLIP_WIDE, SECTION_HEADING, TD } from "@/components/table/styles";
import type { BudgetTransaction, Placement } from "@/lib/actuals";
import type { OneTimeKind } from "@/lib/sorting";
import { formatShortDate } from "@/lib/format";
import { MoveCell } from "./MatchRows";
import { usePlanned } from "./PlannedContext";

/** Shown at first; the rest open with "Show all", so a long month stays readable. */
const FIRST_ROWS = 50;

export function ExpenseList({ transactions, periodWords }: { transactions: BudgetTransaction[]; periodWords: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? transactions : transactions.slice(0, FIRST_ROWS);
  return (
    <section aria-labelledby="expenses-heading" className="mt-12">
      <h2 id="expenses-heading" className={`mb-1 ${SECTION_HEADING}`}>
        Every expense {periodWords}
      </h2>
      <p className="mb-3 max-w-2xl text-pretty text-[14px] text-muted">
        Match any charge to a line in your Ledger. It becomes that charge&rsquo;s own choice, which beats the merchant&rsquo;s rule and
        anything learned.
      </p>
      <DataTable label={`Every expense ${periodWords}`} minWidth="min-w-[760px]" hint="Matched to and Match to">
        <thead>
          <tr>
            <Column kind="date">Date</Column>
            <Column kind="text" className="w-full">
              Merchant
            </Column>
            <Column kind="money" end>
              Amount
            </Column>
            <Column kind="relation">Matched to</Column>
            <Column kind="select">Match to</Column>
          </tr>
        </thead>
        {transactions.length === 0 ? (
          <EmptyRow colSpan={5} />
        ) : (
          <tbody>
            {shown.map((transaction) => (
              <ExpenseRow key={transaction.id} transaction={transaction} />
            ))}
          </tbody>
        )}
      </DataTable>
      {transactions.length > FIRST_ROWS && (
        <button type="button" onClick={() => setAll(!all)} className={`${CELL_BUTTON} mt-2`}>
          {all ? `Show the newest ${FIRST_ROWS}` : `Show all ${transactions.length}`}
        </button>
      )}
    </section>
  );
}

function ExpenseRow({ transaction }: { transaction: BudgetTransaction }) {
  const { itemChoices, oneTimeKinds } = usePlanned();
  const when = formatShortDate(transaction.date, true);
  return (
    <tr>
      <td className={`${TD} text-muted`}>{when}</td>
      <td className={`${TD} max-w-0`}>
        <span className={CLIP_WIDE} title={transaction.name}>
          {transaction.label}
        </span>
        {transaction.pending && <span className="ml-2 text-[13px] text-muted">pending</span>}
      </td>
      <td className={`${TD} text-right tabular-nums`}>
        <Money cents={-transaction.amountCents} />
      </td>
      <td className={`${TD} text-[14px]`}>{matchedWords(transaction, itemChoices, oneTimeKinds)}</td>
      <MoveCell transaction={transaction} when={when} />
    </tr>
  );
}

/** Where the charge counts now, and how it got there: its own choice, the merchant's rule, or learning. */
export function matchedWords(transaction: BudgetTransaction, items: { id: string; label: string }[], kinds: OneTimeKind[]): string {
  if (transaction.markedTransfer) return "Transfer between my accounts";
  if (transaction.markedNotSpending) return "Not spending";
  const placement = transaction.choice ?? transaction.rule ?? transaction.auto ?? null;
  if (!placement) return transaction.usualCents !== undefined ? "Misc · large, waits for you" : "Misc · not sorted";
  const how = transaction.choice ? "" : transaction.rule ? " · rule" : " · auto";
  return `${placeName(placement, items, kinds)}${how}`;
}

function placeName(placement: Placement, items: { id: string; label: string }[], kinds: OneTimeKind[]): string {
  if (placement.kind === "out_of_budget") return "Out of budget";
  if (placement.kind === "one_time") {
    const kind = kinds.find((one) => one.id === placement.oneTimeKindId);
    return kind ? `One-time · ${kind.name}` : "One-time";
  }
  return items.find((item) => item.id === placement.plannedItemId)?.label ?? "A removed line item";
}
