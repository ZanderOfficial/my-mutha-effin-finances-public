"use client";
// The charges behind a row's Spent figure, nested under it: each can be moved elsewhere or unassigned.

import { useActionState, useState } from "react";
import { removeTransactionChoiceAction } from "@/app/budget/sorting-actions";
import { matchSpendingAction } from "@/app/budget/spending-actions";
import { submitWith } from "@/components/ActionForm";
import { Money } from "@/components/Money";
import { ActionCell } from "@/components/table/ActionCell";
import { CELL_BUTTON, CLIP_WIDE, NESTED_ROW } from "@/components/table/styles";
import { isOffPlan, placementOf, type BudgetTransaction } from "@/lib/actuals";
import { formatShortDate } from "@/lib/format";
import type { ActionState } from "@/server/owner-write";
import { CategoryOptions, OneTimeKindOptions } from "./options";
import { usePlanned } from "./PlannedContext";

const IDLE: ActionState = { status: "idle", message: "" };
const CELL = "h-11 whitespace-nowrap border-b border-rule/60 px-3 align-middle";

/** One nested row holding a small table of charges; the ▸ or count that opens it controls `id`. */
export function MatchRows({
  id,
  colSpan,
  label,
  transactions,
  hidden,
}: {
  id: string;
  colSpan: number;
  /** Names the nested table, e.g. "Charges matched to Groceries". */
  label: string;
  transactions: BudgetTransaction[];
  hidden: boolean;
}) {
  return (
    <tr id={id} hidden={hidden} className={NESTED_ROW}>
      <td colSpan={colSpan} className="border-b border-rule/60 py-1 pl-11 pr-2">
        <table className="w-full border-separate border-spacing-0 text-[14px]">
          <caption className="sr-only">{label}</caption>
          <tbody>
            {transactions.map((transaction) => (
              <MatchRow key={transaction.id} transaction={transaction} />
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

function MatchRow({ transaction }: { transaction: BudgetTransaction }) {
  const refund = transaction.amountCents > 0;
  const when = formatShortDate(transaction.date, true);
  return (
    <tr>
      <td className={`${CELL} w-28 text-muted`}>{when}</td>
      <td className={`${CELL} w-full`}>
        <span className={CLIP_WIDE} title={transaction.label}>
          {transaction.label}
        </span>
      </td>
      <td className={`${CELL} text-right tabular-nums`}>
        <Money cents={-transaction.amountCents} />
      </td>
      <td className={`${CELL} text-[13px] text-muted`}>{howSorted(transaction, refund)}</td>
      {refund ? <td className={CELL} colSpan={2} /> : <ChargeActions transaction={transaction} when={when} />}
    </tr>
  );
}

/**
 * Move, and Unassign for a charge sorted on its own (one sorted by a rule goes back to Misc only by undoing
 * the rule). An auto-placed charge is corrected with Move, which makes it a choice of its own.
 */
function ChargeActions({ transaction, when }: { transaction: BudgetTransaction; when: string }) {
  return (
    <>
      <MoveCell transaction={transaction} when={when} />
      {transaction.choice || transaction.markedNotSpending || transaction.markedTransfer ? (
        <ActionCell action={removeTransactionChoiceAction} fields={{ transactionId: transaction.id }}>
          Unassign<span className="sr-only"> {transaction.label} on {when}</span>
        </ActionCell>
      ) : (
        <td className={CELL} />
      )}
    </>
  );
}

/** Why this charge is here, in words. */
function howSorted(transaction: BudgetTransaction, refund: boolean): string {
  const parts = [
    refund ? "refund, taken off" : null,
    transaction.pending ? "pending" : null,
    transaction.markedTransfer
      ? "transfer between my accounts"
      : transaction.markedNotSpending
      ? "not spending"
      : transaction.choice
        ? "sorted on its own"
        : transaction.auto
          ? "auto, learned from your choices"
          : "by the merchant's rule",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Moves one charge elsewhere. It becomes a choice of its own, which beats the merchant's rule. */
export function MoveCell({ transaction, when }: { transaction: BudgetTransaction; when: string }) {
  const { itemChoices } = usePlanned();
  const [state, dispatch, pending] = useActionState(matchSpendingAction, IDLE);
  const [target, setTarget] = useState("");
  return (
    <td className="h-11 whitespace-nowrap border-b border-rule/60 px-1 align-middle">
      <form onSubmit={submitWith(dispatch)} className="flex items-center gap-1">
        <input type="hidden" name="transactionId" value={transaction.id} />
        <select
          name="target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          aria-label={`Move ${transaction.label} on ${when} to`}
          className="cell-input min-h-11 w-44 rounded-md border border-rule"
        >
          <option value="" disabled>
            Move to…
          </option>
          {itemChoices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
          <option value="out">Out of budget</option>
          <option value="one">One-time (won&rsquo;t repeat)</option>
          <option value="transfer">Transfer between my accounts</option>
          <option value="not_spending">Not spending (it came back)</option>
        </select>
        {(target === "out" || target === "one") && <OffPlanTags transaction={transaction} when={when} oneTime={target === "one"} />}
        <button type="submit" disabled={pending} className={CELL_BUTTON}>
          {pending ? "Saving…" : "Move"}
          <span className="sr-only">
            {" "}
            {transaction.label} on {when}
          </span>
        </button>
        <span role="status" className="text-[13px] text-spending">
          {state.status === "error" ? `! ${state.message}` : ""}
        </span>
      </form>
    </td>
  );
}

/** Who an off-plan charge was for, its tax category and, for one-time, what it was, starting from what it carries now. */
function OffPlanTags({ transaction, when, oneTime }: { transaction: BudgetTransaction; when: string; oneTime: boolean }) {
  const { businesses, categories, oneTimeKinds } = usePlanned();
  const placement = placementOf(transaction);
  const tags = placement && isOffPlan(placement) ? placement : { businessId: null, taxCategoryId: null };
  const kindId = placement?.kind === "one_time" ? placement.oneTimeKindId : null;
  return (
    <>
      {oneTime && oneTimeKinds.length > 0 && (
        <select
          name="oneTimeKindId"
          defaultValue={kindId ?? ""}
          aria-label={`What ${transaction.label} on ${when} was`}
          className="cell-input min-h-11 w-36 rounded-md border border-rule"
        >
          <OneTimeKindOptions kinds={oneTimeKinds} />
        </select>
      )}
      {businesses.length > 0 && (
        <select
          name="businessId"
          defaultValue={tags.businessId ?? ""}
          aria-label={`Who ${transaction.label} on ${when} was for`}
          className="cell-input min-h-11 w-32 rounded-md border border-rule"
        >
          <option value="">Personal</option>
          {businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </select>
      )}
      <select
        name="taxCategoryId"
        defaultValue={tags.taxCategoryId ?? ""}
        aria-label={`Tax category for ${transaction.label} on ${when}`}
        className="cell-input min-h-11 w-40 rounded-md border border-rule"
      >
        <CategoryOptions categories={categories} />
      </select>
    </>
  );
}
