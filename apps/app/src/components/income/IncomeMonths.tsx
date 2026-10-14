// The months table, turned sideways: one row per month with its state, deposits, what waits to be sorted and its total.
import { Money } from "@/components/Money";
import { Column, DataTable } from "@/components/table/DataTable";
import { FOOT, GUTTER, NUM, STICKY_FIRST } from "@/components/table/styles";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import type { IncomeMonth, IncomeYear } from "@/lib/income";
import { monthMark } from "@/lib/income-chart";
import type { Business } from "@/lib/sorting";
import { MonthGroup, type NamedDeposit } from "./MonthGroup";

/** The chart's high and low marks, in words with an arrow. */
const MARK_WORDS = { high: "▲ high", low: "▼ low" } as const;

/** It is also the chart's text alternative, so every figure the chart draws is here in words. */
export function IncomeMonths({ year, businesses }: { year: IncomeYear; businesses: Business[] }) {
  const businessName = new Map(businesses.map((business) => [business.id, business.name]));
  return (
    <DataTable label={`Income by month in ${year.year}; the chart above shows the same`} minWidth="min-w-[560px]" hint="Deposits, To sort and Total">
      <thead>
        <tr>
          <Column kind="date" className={cn(STICKY_FIRST, GUTTER, "z-20")}>
            Month
          </Column>
          <Column kind="status" className="md:w-full">
            State
          </Column>
          <Column kind="count" end>
            Deposits
          </Column>
          <Column kind="alert">To sort</Column>
          <Column kind="money" end>
            Total
          </Column>
        </tr>
      </thead>
      {year.months.map((month) => (
        <MonthGroup key={month.month} month={withoutDeposits(month)} mark={markWords(month.month, year)} deposits={named(month, businessName)} />
      ))}
      <YearFoot year={year} />
    </DataTable>
  );
}

/** The year's total, and the average over complete months only (a partial month would drag it down). */
function YearFoot({ year }: { year: IncomeYear }) {
  const complete = year.months.filter((month) => month.state === "complete").length;
  return (
    <tfoot>
      <tr className="font-semibold">
        <th scope="row" className={cn(FOOT, STICKY_FIRST, GUTTER, "text-left")}>
          Year total
        </th>
        <td colSpan={3} className={`${FOOT} font-normal text-muted`}>
          {year.averageCents === null ? (
            "No complete month yet, so no average."
          ) : (
            <>
              Average <Money cents={year.averageCents} className="text-foreground" /> a month over {plural(complete, "complete month")}
            </>
          )}
        </td>
        <td className={`${FOOT} ${NUM} ${year.totalCents === null ? "text-muted" : ""}`}>
          <Money cents={year.totalCents} />
        </td>
      </tr>
    </tfoot>
  );
}

/** "▲ high" and "▼ low" on the same months the chart marks. */
function markWords(month: string, year: IncomeYear): string | null {
  const mark = monthMark(month, year);
  return mark ? MARK_WORDS[mark] : null;
}

/** The month without its deposits, which travel to the client already named. */
function withoutDeposits(month: IncomeMonth): Omit<IncomeMonth, "deposits"> {
  return { month: month.month, state: month.state, totalCents: month.totalCents, unsortedCount: month.unsortedCount };
}

function named(month: IncomeMonth, businessName: Map<string, string>): NamedDeposit[] {
  return month.deposits.map((deposit) => ({ ...deposit, business: deposit.businessId ? (businessName.get(deposit.businessId) ?? null) : null }));
}
