// A business tab's income this year: one row per month and the year's total, in the Income tab's month grammar.
import { Money } from "@/components/Money";
import { Column, DataTable, MoneyCell } from "@/components/table/DataTable";
import { FOOT, GUTTER, NUM, ROW, SECTION_HEADING, STICKY_FIRST, TD } from "@/components/table/styles";
import { monthStateLabel } from "@/lib/budget-table";
import { cn } from "@/lib/cn";
import { formatMonth } from "@/lib/format";
import type { IncomeMonth, IncomeYear } from "@/lib/income";

/** Every figure comes from lib/income; a month not yet known is a dash, never $0.00. */
export function BusinessIncome({ business, income }: { business: string; income: IncomeYear }) {
  const label = `${business} income by month in ${income.year}`;
  return (
    <section aria-labelledby="business-income-heading" className="mt-12 max-w-3xl">
      <h2 id="business-income-heading" className={`mb-1 ${SECTION_HEADING}`}>
        {business} income, {income.year}
      </h2>
      <p className="mb-3 text-[15px] text-muted">Deposits sorted as income and tagged for {business} on the Income tab.</p>
      <DataTable label={label}>
        <thead>
          <tr>
            <Column kind="date" className={cn(STICKY_FIRST, GUTTER, "z-20")}>
              Month
            </Column>
            <Column kind="status" className="md:w-full">
              State
            </Column>
            <Column kind="money" end>
              Income
            </Column>
          </tr>
        </thead>
        <tbody>
          {income.months.map((month) => (
            <MonthRow key={month.month} month={month} />
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <th scope="row" className={cn(FOOT, STICKY_FIRST, GUTTER, "text-left")}>
              Year total
            </th>
            <td className={FOOT} />
            <td className={cn(FOOT, NUM, income.totalCents === null && "text-muted")}>
              <Money cents={income.totalCents} />
            </td>
          </tr>
        </tfoot>
      </DataTable>
    </section>
  );
}

function MonthRow({ month }: { month: IncomeMonth }) {
  const known = month.totalCents !== null;
  const state = monthStateLabel(month.state);
  return (
    <tr className={cn(ROW, !known && "text-muted")}>
      <th scope="row" className={cn(TD, STICKY_FIRST, GUTTER, "text-left font-normal")}>
        {formatMonth(month.month, true)}
      </th>
      <td className={TD}>
        <span aria-hidden="true">{state.glyph} </span>
        {state.words}
      </td>
      <MoneyCell cents={month.totalCents} className={known ? "font-semibold" : ""} />
    </tr>
  );
}
