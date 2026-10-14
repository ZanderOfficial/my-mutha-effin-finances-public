// The owner's spending rules as a table: where each merchant's spending goes, each one undoable.
import { removeSourceRuleAction } from "@/app/budget/sorting-actions";
import { ActionCell } from "@/components/table/ActionCell";
import { Column, DataTable, EmptyRow } from "@/components/table/DataTable";
import { CELL, NUM, TD } from "@/components/table/styles";
import type { SpendingRule } from "@/lib/sorting";

export function SpendingRules({ rules }: { rules: SpendingRule[] }) {
  return (
    <>
      <p className="mb-3 max-w-2xl text-pretty text-[14px] text-muted">
        Sorting a merchant from To sort with &ldquo;Always&rdquo; ticked makes a rule, and it handles that merchant&rsquo;s later spending too.
      </p>
      <DataTable label="Spending rules">
        <thead>
          <tr>
            <Column kind="text" className="w-full">
              Merchant
            </Column>
            <Column kind="relation">Sorted to</Column>
            <Column kind="count" end>
              Charges
            </Column>
            <Column srOnly>Undo</Column>
          </tr>
        </thead>
        {rules.length === 0 ? (
          <EmptyRow colSpan={4} />
        ) : (
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <th scope="row" className={`${CELL} px-2.5 text-left font-normal`}>{rule.label}</th>
                <td className={`${CELL} px-2.5`}>{rule.target}</td>
                <td className={`${TD} ${NUM}`}>{rule.spendingCount}</td>
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
