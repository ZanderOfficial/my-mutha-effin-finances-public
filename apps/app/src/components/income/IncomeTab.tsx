// The Income sub-tab of the Budget page: the hero, deposits to sort, the year's chart and months table, and the rules.
import { figureLabel, ViewTabs } from "@/components/Chips";
import { HeroFigure } from "@/components/HeroFigure";
import { Money } from "@/components/Money";
import { ViewSwitch } from "@/components/table/Disclosure";
import { SECTION_HEADING } from "@/components/table/styles";
import { budgetHref } from "@/lib/budget-views";
import { formatMonth, plural } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { depositsWaiting } from "@/lib/sorting";
import type { YearFlow } from "@/lib/year-flow";
import type { IncomeData } from "@/server/reports";
import { Businesses } from "./Businesses";
import { IncomeChart } from "./IncomeChart";
import { IncomeMonths } from "./IncomeMonths";
import { OneOffs, SortingRules } from "./SortingRules";
import { UnsortedInbox } from "./UnsortedInbox";

export function IncomeTab({ data }: { data: IncomeData }) {
  return (
    <>
      <IncomeHero data={data} />

      {/* Kept in the page while it empties, so the last sort can say "All sorted"; empty from the start, it shows nothing. */}
      {data.canEdit && <UnsortedInbox sources={data.unsorted} businesses={data.businesses} />}

      <section aria-labelledby="by-month-heading" className="mb-12">
        <div className="mb-3 flex flex-wrap items-center gap-x-3">
          <h2 id="by-month-heading" className={SECTION_HEADING}>
            Deposits by month
          </h2>
          {data.years.length > 1 && (
            <ViewTabs
              label="Year"
              items={data.years.map((year) => ({
                label: String(year),
                href: budgetHref({ kind: "income", year }),
                current: year === data.year,
              }))}
            />
          )}
        </div>
        <IncomeChart year={data.income} />
        <IncomeMonths year={data.income} businesses={data.businesses} />
      </section>

      {data.canEdit && (
        <section aria-label="Sorting rules, one-offs and businesses">
          <ViewSwitch
            label="Rules and businesses"
            views={[
              { id: "rules", label: "Sorting rules", count: data.rules.length, content: <SortingRules rules={data.rules} /> },
              { id: "one-offs", label: "One-offs", count: data.handSorted.length, content: <OneOffs deposits={data.handSorted} year={data.year} /> },
              { id: "businesses", label: "Businesses", count: data.businesses.length, content: <Businesses businesses={data.businesses} /> },
            ]}
          />
        </section>
      )}
    </>
  );
}

/** The year's income, its average month and the month so far, then what went out and what was left over. */
function IncomeHero({ data }: { data: IncomeData }) {
  return (
    <div className="pb-8">
      <IncomeFigures data={data} />
      {data.flow && <LeftOver flow={data.flow} year={data.year} />}
    </div>
  );
}

/** Income, its average month and the month so far, then the plain line about what may be missing. */
function IncomeFigures({ data }: { data: IncomeData }) {
  const { income } = data;
  const partial = income.months.find((month) => month.state === "partial");
  return (
    <section aria-label={`Income in ${data.year}`} className="flex flex-wrap items-end gap-x-16 gap-y-6">
      <div>
        <div className={`mb-2 ${figureLabel}`}>Income in {data.year}</div>
        <div className={`hero-numeral hero-in ${income.totalCents === null ? "text-muted" : "glow-income"}`}>
          <Money cents={income.totalCents} compact />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-12 gap-y-4 pb-2">
        <HeroFigure label="Average month">
          <Money cents={income.averageCents} />
        </HeroFigure>
        {partial && (
          <HeroFigure label={`${formatMonth(partial.month, true)} so far`}>
            <Money cents={partial.totalCents} />
          </HeroFigure>
        )}
      </div>
      <p className="max-w-xs text-pretty pb-3 text-[15px] text-muted">{heroLine(data)}</p>
    </section>
  );
}

/** The average in words, and a warning while deposits wait to be sorted. */
function heroLine(data: IncomeData): string {
  if (data.income.totalCents === null) return "Income shows here once an institution has synced.";
  const waiting = depositsWaiting(data.unsorted);
  const average =
    data.income.averageCents === null
      ? "No complete month yet, so there is no average."
      : `Average ${formatCents(data.income.averageCents, { trimZeroCents: true })} a month over complete months.`;
  if (waiting === 0) return average;
  return `${average} ${plural(waiting, "deposit")} still to sort, so this may read low.`;
}

/** Every real purchase this year against the same months' income, and what is left over; negative reads red. */
function LeftOver({ flow, year }: { flow: YearFlow; year: number }) {
  const left = flow.keptCents;
  const tone = left === null ? "text-muted" : left < 0 ? "glow-spending" : "glow-income";
  return (
    <section aria-label={`Spent and left over in ${year}`} className="mt-8 flex flex-wrap items-end gap-x-16 gap-y-6">
      <div>
        <div className={`mb-2 ${figureLabel}`}>Spent in {year}</div>
        <div className={`${SUB_NUMERAL} ${flow.spentCents === null ? "text-muted" : "glow-spending"}`} style={SUB_SIZE}>
          <Money cents={flow.spentCents} compact />
        </div>
      </div>
      <div>
        <div className={`mb-2 ${figureLabel}`}>{left !== null && left < 0 ? "Spent past income" : "Left over"}</div>
        <div className={`${SUB_NUMERAL} ${tone}`} style={SUB_SIZE}>
          <Money cents={left === null ? null : Math.abs(left)} compact />
        </div>
      </div>
      <p className="max-w-xs text-pretty pb-3 text-[15px] text-muted">{leftOverLine(flow)}</p>
    </section>
  );
}

/** The hero numeral's face at a size two can share a row; inline, since .hero-numeral's own size outranks a utility. */
const SUB_NUMERAL = "hero-numeral hero-in";
const SUB_SIZE = { fontSize: "clamp(56px, 7vw, 112px)" };

function leftOverLine(flow: YearFlow): string {
  if (flow.keptCents === null) return "Spending shows here once an institution has synced.";
  const over = flow.overMonths > 0 ? ` ${plural(flow.overMonths, "month")} spent more than came in.` : "";
  return `Every real purchase in the same months as the income above, sorted or not. Transfers and card payments are left out.${over}`;
}
