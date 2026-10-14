"use client";
// One month of the income table: its row, and its deposits nested under it behind the ▸, each one re-markable.

import { useState } from "react";
import { markTransactionAction } from "@/app/budget/sorting-actions";
import { Money } from "@/components/Money";
import { ActionCell } from "@/components/table/ActionCell";
import { MoneyCell } from "@/components/table/DataTable";
import { ExpandButton } from "@/components/table/Disclosure";
import { CLIP_WIDE, GUTTER, GUTTER_BUTTON, NESTED_ROW, NUM, ROW, STICKY_FIRST, TAG, TD } from "@/components/table/styles";
import { cn } from "@/lib/cn";
import { monthStateLabel } from "@/lib/budget-table";
import { formatMonth, formatShortDate } from "@/lib/format";
import type { IncomeDeposit, IncomeMonth } from "@/lib/income";

/** Month (with its ▸), State, Deposits, To sort, Total. */
const MONTH_COLUMNS = 5;

/** A deposit with its business already named, so the client needs no lookup table. */
export type NamedDeposit = IncomeDeposit & { business: string | null };

export function MonthGroup({ month, mark, deposits }: { month: Omit<IncomeMonth, "deposits">; mark: string | null; deposits: NamedDeposit[] }) {
  const [open, setOpen] = useState(false);
  const name = formatMonth(month.month, true);
  const known = month.totalCents !== null;
  const state = monthStateLabel(month.state);
  const nestedId = `month-${month.month}`;
  return (
    <tbody>
      <tr className={`${ROW} ${known ? "" : "text-muted"}`}>
        <th scope="row" aria-label={name} className={cn(TD, STICKY_FIRST, GUTTER, "text-left font-normal")}>
          {deposits.length > 0 && (
            <ExpandButton expanded={open} controls={nestedId} label={`${name} deposits`} onToggle={() => setOpen(!open)} className={GUTTER_BUTTON} />
          )}
          {name}
          {/* On a phone the total rides under the month, so it shows before any sideways scroll. */}
          <span aria-hidden="true" className="block text-[13px] text-muted md:hidden">
            <Money cents={month.totalCents} />
          </span>
        </th>
        <td className={TD}>
          <span aria-hidden="true">{state.glyph} </span>
          {state.words}
          {mark && <span className="ml-2 text-muted">{mark}</span>}
        </td>
        <td className={`${TD} ${NUM}`}>{known ? deposits.length : "—"}</td>
        <td className={TD}>
          {month.unsortedCount > 0 ? (
            <a href="#unsorted" className="inline-flex min-h-11 items-center font-semibold text-spending underline underline-offset-4">
              ! {month.unsortedCount} to sort
            </a>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <MoneyCell cents={month.totalCents} className={known ? "font-semibold" : ""} />
      </tr>
      {deposits.length > 0 && <DepositRows id={nestedId} name={name} deposits={deposits} hidden={!open} />}
    </tbody>
  );
}

function DepositRows({ id, name, deposits, hidden }: { id: string; name: string; deposits: NamedDeposit[]; hidden: boolean }) {
  return (
    <tr id={id} hidden={hidden} className={NESTED_ROW}>
      <td colSpan={MONTH_COLUMNS} className="border-b border-rule/60 py-1 pl-11 pr-2.5">
        <table className="w-full border-separate border-spacing-0 text-[14px]">
          <caption className="sr-only">Income deposits in {name}</caption>
          <tbody>
            {deposits.map((deposit) => (
              <tr key={deposit.id}>
                <td className={`${TD} w-24 text-muted`}>{formatShortDate(deposit.date)}</td>
                <td className={`${TD} w-full`}>
                  <span className={CLIP_WIDE} title={deposit.label}>
                    {deposit.label}
                  </span>
                  {deposit.pending && <span className="ml-2 text-[13px] text-muted">pending</span>}
                </td>
                <td className={TD}>
                  <span className={TAG}>{deposit.business ?? "Personal"}</span>
                </td>
                <td className={`${TD} ${NUM}`}>
                  <Money cents={deposit.amountCents} />
                </td>
                {/* A deposit that came back to the owner (a refund, a deposit returned from escrow) is not income. */}
                <ActionCell action={markTransactionAction} fields={{ transactionId: deposit.id, kind: "not_income" }}>
                  Not income<span className="sr-only">: {deposit.label}, {formatShortDate(deposit.date)}</span>
                </ActionCell>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}
