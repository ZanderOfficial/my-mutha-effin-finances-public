// The one-time catch-up on the year so far: each month's made, spent and kept, then everything left to sort.
import Link from "next/link";
import { figureLabel } from "@/components/Chips";
import { HeroFigure } from "@/components/HeroFigure";
import { UnsortedInbox } from "@/components/income/UnsortedInbox";
import { Money } from "@/components/Money";
import { Column, DataTable, MoneyCell } from "@/components/table/DataTable";
import { FOOT, NUM, SECTION_HEADING, TD } from "@/components/table/styles";
import { budgetHref, EXPENSES } from "@/lib/budget-views";
import { formatMonth, plural } from "@/lib/format";
import { itemChoices } from "@/lib/planned-budget";
import type { FlowMonth, YearFlow } from "@/lib/year-flow";
import type { CatchUpData } from "@/server/reports";
import { ExpenseList } from "./ExpenseList";
import { MiscInbox } from "./MiscInbox";
import { PlannedProvider } from "./PlannedContext";
import { plannedContext } from "./PlannedTable";

export function CatchUpTab({ data }: { data: CatchUpData }) {
  const { planned, flow, unsorted } = data;
  const { actuals } = planned;
  return (
    <>
      <CatchUpHero flow={flow} />
      {flow && <MonthByMonth flow={flow} />}

      {planned.canEdit && (
        <>
          <UnsortedInbox sources={unsorted} businesses={planned.businesses} />
          <MiscInbox
            merchants={actuals.misc}
            count={actuals.miscCount}
            since={planned.startDate}
            choices={{ items: itemChoices(planned.allItems), businesses: planned.businesses, categories: planned.categories, oneTimeKinds: planned.oneTimeKinds }}
          />
          <PlannedProvider value={plannedContext(planned)}>
            <ExpenseList transactions={actuals.spending} periodWords="this year so far" />
          </PlannedProvider>
        </>
      )}
    </>
  );
}

/** The year in three figures, and why the page exists: sort it once, then Expenses keeps it current. */
function CatchUpHero({ flow }: { flow: YearFlow | null }) {
  return (
    <section aria-label="The year so far" className="pb-8">
      <div className={`mb-2 ${figureLabel}`}>Catch up on {flow?.year ?? "the year"}</div>
      <p className="max-w-2xl text-pretty text-[17px]">
        Sort this year&rsquo;s deposits and expenses once, here. From then on{" "}
        <Link href={budgetHref(EXPENSES)} className="underline underline-offset-4">
          Expenses
        </Link>{" "}
        and the Income tab keep up as new transactions arrive.
      </p>
      <div className="mt-6 flex flex-wrap items-end gap-x-12 gap-y-6">
        <HeroFigure label="Made so far">
          <Money cents={flow?.madeCents ?? null} />
        </HeroFigure>
        <HeroFigure label="Spent so far">
          <Money cents={flow?.spentCents ?? null} />
        </HeroFigure>
        <HeroFigure label="Kept so far">
          <span className={(flow?.keptCents ?? 0) < 0 ? "text-spending" : ""}>
            <Money cents={flow?.keptCents ?? null} />
          </span>
        </HeroFigure>
      </div>
    </section>
  );
}

/** One row per month: made, spent, kept, and a word for a month that spent past its income. */
function MonthByMonth({ flow }: { flow: YearFlow }) {
  return (
    <section aria-labelledby="month-by-month-heading" className="mb-12">
      <h2 id="month-by-month-heading" className={`mb-1 ${SECTION_HEADING}`}>
        Month by month
      </h2>
      <p className="mb-3 max-w-2xl text-pretty text-[14px] text-muted">
        Spent is every real purchase, sorted or not; transfers between your accounts and card payments never count.
        {flow.overMonths > 0 && ` ${plural(flow.overMonths, "month")} spent more than came in.`}
      </p>
      <DataTable label={`Made, spent and kept each month in ${flow.year}`} minWidth="min-w-[620px]" hint="Kept and Verdict">
        <thead>
          <tr>
            <Column kind="date">Month</Column>
            <Column kind="money" end>
              Made
            </Column>
            <Column kind="money" end>
              Spent
            </Column>
            <Column kind="computed" end>
              Kept
            </Column>
            <Column kind="status" className="w-full">
              Verdict
            </Column>
          </tr>
        </thead>
        <tbody>
          {flow.months.map((month) => (
            <MonthRow key={month.month} month={month} />
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <th scope="row" className={`${FOOT} text-left`}>
              Year so far
            </th>
            <td className={`${FOOT} ${NUM}`}>
              <Money cents={flow.madeCents} />
            </td>
            <td className={`${FOOT} ${NUM}`}>
              <Money cents={flow.spentCents} />
            </td>
            <td className={`${FOOT} ${NUM}`}>
              <Money cents={flow.keptCents} />
            </td>
            <td className={FOOT} />
          </tr>
        </tfoot>
      </DataTable>
    </section>
  );
}

function MonthRow({ month }: { month: FlowMonth }) {
  const known = month.keptCents !== null;
  return (
    <tr className={known ? "" : "text-muted"}>
      <th scope="row" className={`${TD} text-left font-normal`}>
        {formatMonth(month.month, true)}
        {month.state === "partial" && <span className="ml-2 text-[13px] text-muted">so far</span>}
      </th>
      <MoneyCell cents={month.madeCents} />
      <MoneyCell cents={month.spentCents} />
      <MoneyCell cents={month.keptCents} className="font-semibold" />
      <td className={TD}>
        <Verdict month={month} />
      </td>
    </tr>
  );
}

/** In words, never colour alone; a month with deposits still to sort says its income may read low. */
function Verdict({ month }: { month: FlowMonth }) {
  if (month.keptCents === null) return <span className="text-muted">—</span>;
  const toSort = month.depositsToSort > 0 ? ` · ${plural(month.depositsToSort, "deposit")} to sort, so made may read low` : "";
  if (month.keptCents < 0) {
    return (
      <span>
        <span className="font-semibold text-spending">! Spent more than came in</span>
        <span className="text-muted">{toSort}</span>
      </span>
    );
  }
  return (
    <span>
      <span className="text-income">✓ Kept money</span>
      <span className="text-muted">{toSort}</span>
    </span>
  );
}
