// "Totals by": this view's planned and spent totals split by the owner's tax category or by Schedule C line.
import { ViewTabs } from "@/components/Chips";
import { Money } from "@/components/Money";
import { Column, DataTable, EmptyRow, MoneyCell } from "@/components/table/DataTable";
import { CELL, FOOT, NUM, SECTION_HEADING } from "@/components/table/styles";
import type { LabelledTotal, TotalsBy } from "@/lib/tax-categories";

type Row = { label: string; muted: boolean; planned: number | null; spent: number | null };

export function PlannedTotals({
  plannedCents,
  spentCents,
  totals,
  spentTotals,
  by,
  hrefFor,
}: {
  plannedCents: number | null;
  /** Null while actuals are unknown. */
  spentCents: number | null;
  totals: LabelledTotal[];
  spentTotals: LabelledTotal[];
  by: TotalsBy;
  hrefFor: (by: TotalsBy) => string;
}) {
  const rows = mergeTotals(totals, spentTotals, spentCents !== null);
  return (
    <section aria-labelledby="totals-by-heading" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-3">
        <h2 id="totals-by-heading" className={SECTION_HEADING}>
          Totals by
        </h2>
        <ViewTabs
          label="Totals by"
          items={[
            { label: "My categories", href: hrefFor("category"), current: by === "category" },
            { label: "Schedule C lines", href: hrefFor("line"), current: by === "line" },
          ]}
        />
      </div>
      <DataTable label={by === "category" ? "Totals by tax category" : "Totals by Schedule C line"}>
        <thead>
          <tr>
            <Column kind="select" className="w-full">
              {by === "category" ? "Tax category" : "Schedule C line"}
            </Column>
            <Column kind="money" end>
              Planned
            </Column>
            <Column kind="relation" end>
              Spent
            </Column>
          </tr>
        </thead>
        {rows.length === 0 ? (
          <EmptyRow colSpan={3} />
        ) : (
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className={`${CELL} px-2.5 text-left font-normal ${row.muted ? "text-muted" : ""}`}>
                  {row.label}
                </th>
                <MoneyCell cents={row.planned} />
                <MoneyCell cents={row.spent} />
              </tr>
            ))}
          </tbody>
        )}
        <tfoot>
          <tr className="font-semibold">
            <th scope="row" className={`${FOOT} text-left`}>
              Total
            </th>
            <td className={`${FOOT} ${NUM}`}>
              <Money cents={plannedCents} />
            </td>
            <td className={`${FOOT} ${NUM}`}>
              <Money cents={spentCents} />
            </td>
          </tr>
        </tfoot>
      </DataTable>
    </section>
  );
}

/** One row per label from either side. A side with no amount for a label is $0.00 when known, a dash when not. */
function mergeTotals(planned: LabelledTotal[], spent: LabelledTotal[], spentKnown: boolean): Row[] {
  const rows = new Map<string, Row>();
  for (const total of planned) rows.set(total.label, { label: total.label, muted: total.muted, planned: total.totalCents, spent: null });
  for (const total of spent) {
    const row = rows.get(total.label) ?? { label: total.label, muted: total.muted, planned: 0, spent: null };
    rows.set(total.label, { ...row, spent: total.totalCents });
  }
  return [...rows.values()].map((row) => ({ ...row, spent: row.spent ?? (spentKnown ? 0 : null) }));
}
