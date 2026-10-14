// The owner's income decisions as tables: rules by source, and deposits decided one at a time, each undoable.
import { removeSourceRuleAction, removeTransactionChoiceAction } from "@/app/budget/sorting-actions";
import { Money } from "@/components/Money";
import { ActionCell } from "@/components/table/ActionCell";
import { Column, DataTable, EmptyRow } from "@/components/table/DataTable";
import { CELL, NUM, TAG, TD } from "@/components/table/styles";
import { formatShortDate } from "@/lib/format";
import type { HandSortedDeposit, SourceRule } from "@/lib/sorting";

export function SortingRules({ rules }: { rules: SourceRule[] }) {
  return (
    <>
      <p className="mb-3 max-w-2xl text-pretty text-[14px] text-muted">
        Sorting a source with &ldquo;Always&rdquo; ticked makes a rule, and it handles that source&rsquo;s later deposits too.
      </p>
      <DataTable label="Sorting rules" minWidth="min-w-[480px]" hint="Deposits and Undo">
        <thead>
          <tr>
            <Column kind="text" className="w-full">
              Source
            </Column>
            <Column kind="select">Decision</Column>
            <Column kind="tags">For</Column>
            <Column kind="count" end>
              Deposits
            </Column>
            <Column srOnly>Undo</Column>
          </tr>
        </thead>
        {rules.length === 0 ? (
          <EmptyRow colSpan={5} />
        ) : (
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <th scope="row" className={`${CELL} px-2.5 text-left font-normal`}>{rule.label}</th>
                <DecisionCells kind={rule.kind} businessName={rule.businessName} />
                <td className={`${TD} ${NUM}`}>{rule.depositCount}</td>
                <ActionCell action={removeSourceRuleAction} fields={{ ruleId: rule.id }}>
                  Undo<span className="sr-only"> the rule for {rule.label}</span>
                </ActionCell>
              </tr>
            ))}
          </tbody>
        )}
      </DataTable>
    </>
  );
}

/** Deposits decided one at a time in the shown year. Undo sends one back to To sort, or to Plaid's label. */
export function OneOffs({ deposits, year }: { deposits: HandSortedDeposit[]; year: number }) {
  return (
    <DataTable label={`Deposits sorted one at a time in ${year}`} minWidth="min-w-[600px]" hint="Decision, For and Undo">
      <thead>
        <tr>
          <Column kind="date">Date</Column>
          <Column kind="text" className="w-full">
            Source
          </Column>
          <Column kind="money" end>
            Amount
          </Column>
          <Column kind="select">Decision</Column>
          <Column kind="tags">For</Column>
          <Column srOnly>Undo</Column>
        </tr>
      </thead>
      {deposits.length === 0 ? (
        <EmptyRow colSpan={6} />
      ) : (
        <tbody>
          {deposits.map((deposit) => (
            <tr key={deposit.id}>
              <td className={`${TD} text-muted`}>{formatShortDate(deposit.date, true)}</td>
              <th scope="row" className={`${CELL} px-2.5 text-left font-normal`}>{deposit.label}</th>
              <td className={`${TD} ${NUM}`}>
                <Money cents={deposit.amountCents} />
              </td>
              <DecisionCells kind={deposit.kind} businessName={deposit.businessName} />
              <ActionCell action={removeTransactionChoiceAction} fields={{ transactionId: deposit.id }}>
                Undo
                <span className="sr-only">
                  {" "}
                  for {deposit.label} on {formatShortDate(deposit.date, true)}
                </span>
              </ActionCell>
            </tr>
          ))}
        </tbody>
      )}
    </DataTable>
  );
}

/** "✓ Income" for a business or personal, or "✕ Not income", which is for no one. */
function DecisionCells({ kind, businessName }: { kind: SourceRule["kind"]; businessName: string | null }) {
  if (kind === "not_income") {
    return (
      <>
        <td className={`${TD} text-muted`}>
          <span aria-hidden="true">✕ </span>Not income
        </td>
        <td className={`${TD} text-muted`}>—</td>
      </>
    );
  }
  return (
    <>
      <td className={`${TD} font-semibold text-income`}>
        <span aria-hidden="true">✓ </span>Income
      </td>
      <td className={TD}>
        <span className={TAG}>{businessName ?? "Personal"}</span>
      </td>
    </>
  );
}
