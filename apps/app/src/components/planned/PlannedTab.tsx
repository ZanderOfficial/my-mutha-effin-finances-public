// The Expenses tab, the Ledger and each business's tab: a hero, To sort, the items table, a business's income, and totals by tax line.
import Link from "next/link";
import { figureLabel, Segmented, ViewTabs } from "@/components/Chips";
import { HeroFigure } from "@/components/HeroFigure";
import { Money } from "@/components/Money";
import { StateText } from "@/components/table/DataTable";
import { ViewSwitch } from "@/components/table/Disclosure";
import { budgetHref, EXPENSES, LEDGER, type BudgetView } from "@/lib/budget-views";
import { madeVerdict, planVerdict } from "@/lib/budget-table";
import { formatShortDate, plural } from "@/lib/format";
import { needWords, standingSentence } from "@/lib/month-standing";
import { itemChoices, type PlannedView } from "@/lib/planned-budget";
import { monthWindow } from "@/lib/month";
import type { TotalsBy } from "@/lib/tax-categories";
import type { PlannedData } from "@/server/reports";
import { Businesses } from "@/components/income/Businesses";
import { BusinessIncome } from "./BusinessIncome";
import { MiscInbox } from "./MiscInbox";
import { OneTimeKinds } from "./OneTimeKinds";
import { ExpenseList } from "./ExpenseList";
import { PlannedProvider } from "./PlannedContext";
import { plannedContext, PlannedTable } from "./PlannedTable";
import { PlannedTotals } from "./PlannedTotals";
import { SpendingRules } from "./SpendingRules";
import { TaxCategories } from "./TaxCategories";

type ViewChange = { period?: PlannedView; by?: TotalsBy; personalOnly?: boolean };

/** Expenses checks this month against the Ledger and holds the Misc pile; the Ledger is where the budget is edited. */
export type PlannedMode = "expenses" | "ledger";

export function PlannedTab({ data, mode }: { data: PlannedData; mode: PlannedMode }) {
  const { budget, tab, actuals } = data;
  const business = tab.kind === "business" ? data.businesses.find((b) => b.id === tab.businessId) : undefined;
  const title = business?.name ?? (mode === "expenses" ? "Expenses" : "Ledger");
  const viewWith = (change: ViewChange) => budgetHref(currentView(data, mode, change));
  const expenses = mode === "expenses" && tab.kind === "planned";
  // Kept in the page while it empties, so the last sort can say "All sorted"; empty from the start, it shows nothing.
  const showMisc = data.canEdit && expenses;

  return (
    <>
      {expenses && data.standing ? (
        <ExpensesHero standing={data.standing} today={data.today} />
      ) : (
        <PlannedHero data={data} business={business?.name ?? null} />
      )}

      {showMisc && (
        <MiscInbox
          merchants={actuals.misc}
          count={actuals.miscCount}
          since={data.startDate}
          choices={{ items: itemChoices(data.allItems), businesses: data.businesses, categories: data.categories, oneTimeKinds: data.oneTimeKinds }}
        />
      )}

      <ViewControls data={data} viewWith={viewWith} />

      {budget.sharedCount > 0 && (
        <p className="mb-4 max-w-2xl border-l-2 border-foreground pl-3 text-[15px]">
          {plural(budget.sharedCount, "cost")} here {budget.sharedCount === 1 ? "is" : "are"} shared with other businesses and counted in
          full, not as {title}&rsquo;s share. Business tabs can add up to more than Planned.
        </p>
      )}

      <PlannedTable data={data} title={title} />

      {business && data.businessIncome && <BusinessIncome business={business.name} income={data.businessIncome} />}

      {expenses && data.canEdit && (
        <PlannedProvider value={plannedContext(data)}>
          <ExpenseList transactions={actuals.spending} periodWords={data.period === "annual" ? "this year so far" : "this month"} />
        </PlannedProvider>
      )}

      {!expenses && <TotalsAndLists data={data} viewWith={viewWith} />}
    </>
  );
}

type Standing = NonNullable<PlannedData["standing"]>;

/** This month in one figure: income minus what the month needs minus extras, then the figures it comes from. */
function ExpensesHero({ standing, today }: { standing: Standing; today: string }) {
  const value = standing.standingCents;
  const tone = value === null ? "text-muted" : value < 0 ? "glow-spending" : "glow-income";
  return (
    <section aria-label="This month" className="pb-8">
      <div className={`mb-2 ${figureLabel}`}>After everything this month</div>
      <div className={`hero-numeral hero-in ${tone}`}>
        <Money cents={value} sign compact />
      </div>
      <p className="mt-2 text-[17px]">{standingSentence(value, monthWindow(today).daysLeft) ?? "Nothing here yet."}</p>
      <div className="mt-6 flex flex-wrap items-end gap-x-12 gap-y-6">
        <HeroFigure label="Made this month">
          <Money cents={standing.incomeCents} />
        </HeroFigure>
        <HeroFigure label="The month needs">
          <Money cents={standing.needCents} />
        </HeroFigure>
        <HeroFigure label="Spent this month">
          <Money cents={standing.spentCents} />
          {standing.unsortedCents !== null && standing.unsortedCents > 0 && (
            <span className="block font-sans text-[15px] font-normal text-muted">
              includes <Money cents={standing.unsortedCents} className="text-foreground" /> not sorted yet
            </span>
          )}
        </HeroFigure>
        <NeedNote standing={standing} />
      </div>
      {/* Sorting the year before checking started is done once, on its own page. */}
      <Link href={budgetHref({ kind: "catch-up" })} className="mt-4 inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-4">
        Catch up on {today.slice(0, 4)}: sort the year so far
      </Link>
    </section>
  );
}

/** How the figure is worked out, in words, or what is missing for it. */
function NeedNote({ standing }: { standing: Standing }) {
  const need = needWords(standing);
  if (!need) {
    return (
      <p className="max-w-md text-pretty pb-1.5 text-[15px] text-muted">
        Add your monthly and annual costs to the{" "}
        <Link href={budgetHref(LEDGER)} className="underline underline-offset-4">
          Ledger
        </Link>{" "}
        to see whether income covers them.
      </p>
    );
  }
  return (
    <p className="max-w-md text-pretty pb-1.5 text-[15px] text-muted">
      Income minus what the month needs ({need}), minus <Money cents={standing.extrasCents} className="text-foreground" /> spent
      outside the plan: out of budget, not sorted yet, or over a line&rsquo;s plan.
    </p>
  );
}

/** Monthly | Annual as view tabs; on the Planned tab, All | Personal as a filter. */
function ViewControls({ data, viewWith }: { data: PlannedData; viewWith: (change: ViewChange) => string }) {
  const { tab } = data;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      <ViewTabs
        label="Monthly or annual"
        items={[
          { label: "Monthly", href: viewWith({ period: "monthly" }), current: data.period === "monthly" },
          { label: "Annual", href: viewWith({ period: "annual" }), current: data.period === "annual" },
        ]}
      />
      {tab.kind === "planned" && (
        <Segmented
          label="Whose costs"
          items={[
            { label: "All", href: viewWith({ personalOnly: false }), current: !tab.personalOnly },
            { label: "Personal", href: viewWith({ personalOnly: true }), current: tab.personalOnly },
          ]}
        />
      )}
    </div>
  );
}

/** "Totals by", and on the Planned tab the owner's spending rules and tax categories beside it. */
function TotalsAndLists({ data, viewWith }: { data: PlannedData; viewWith: (change: ViewChange) => string }) {
  const lists = data.canEdit && data.tab.kind === "planned";
  return (
    <div className={`mt-12 grid gap-x-8 gap-y-12 ${lists ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" : "max-w-3xl"}`}>
      <PlannedTotals
        plannedCents={data.budget.totalCents}
        spentCents={data.actuals.totalCents}
        totals={data.totals}
        spentTotals={data.actualTotals}
        by={data.by}
        hrefFor={(by) => viewWith({ by })}
      />
      {lists && (
        <section aria-label="Spending rules and tax categories" className="min-w-0">
          <ViewSwitch
            label="Rules and categories"
            views={[
              { id: "rules", label: "Spending rules", count: data.spendingRules.length, content: <SpendingRules rules={data.spendingRules} /> },
              { id: "tax", label: "Tax categories", count: data.categories.length, content: <TaxCategories categories={data.categories} scheduleC={data.scheduleC} /> },
              { id: "businesses", label: "Businesses", count: data.businesses.length, content: <Businesses businesses={data.businesses} /> },
              { id: "one-time", label: "One-time kinds", count: data.oneTimeKinds.length, content: <OneTimeKinds kinds={data.oneTimeKinds} /> },
            ]}
          />
        </section>
      )}
    </div>
  );
}

/**
 * Planned for the view on its own line, then income made against it, what was really spent, how the plan stands (against
 * spending on paying line items only, said in words when Spent shows more) and the plain words around them. The same layout in both views, so switching Monthly and Annual moves nothing.
 */
function PlannedHero({ data, business }: { data: PlannedData; business: string | null }) {
  const { budget, actuals, period } = data;
  const each = period === "annual" ? "each year" : "each month";
  const spentWhen = period === "annual" ? "Spent this year so far" : "Spent this month";
  const madeWhen = period === "annual" ? "Made this year so far" : "Made this month";
  const { verdict, comparedCents } = planVerdict(budget.totalCents, actuals);
  const made = madeVerdict(budget.totalCents, data.madeCents, period);
  const whole = period === "monthly" ? data.standing : null;
  return (
    <section aria-label={business ? `${business}, planned` : "Planned"} className="pb-8">
      <div className={`mb-2 ${figureLabel}`}>{business ? `${business}, planned ${each}` : `Planned ${each}`}</div>
      <div className={`hero-numeral hero-in ${budget.totalCents === null ? "text-muted" : ""}`}>
        <Money cents={budget.totalCents} compact />
      </div>
      <div className="mt-6 flex flex-wrap items-end gap-x-12 gap-y-6">
        <HeroFigure label={madeWhen}>
          <Money cents={data.madeCents} />
        </HeroFigure>
        {whole ? (
          <StandingFigure standing={whole} today={data.today} />
        ) : (
          made && (
            <HeroFigure label="Made against planned">
              <StateText state={made} />
            </HeroFigure>
          )
        )}
        <HeroFigure label={spentWhen}>
          <Money cents={actuals.periodSpentCents} />
          <UnsortedNote actuals={actuals} everything={data.tab.kind === "planned" && !data.tab.personalOnly} />
        </HeroFigure>
        {verdict && (
          <HeroFigure label="Standing">
            <StateText state={verdict} />
            {comparedCents !== null && (
              <span className="block font-sans text-[15px] font-normal text-muted">
                against <Money cents={comparedCents} className="text-foreground" /> spent on paying line items
              </span>
            )}
          </HeroFigure>
        )}
        <HeroNote data={data} />
      </div>
    </section>
  );
}

/** Income against everything the month needs, less extras: the headline, as on the Overview. */
function StandingFigure({ standing, today }: { standing: NonNullable<PlannedData["standing"]>; today: string }) {
  const sentence = standingSentence(standing.standingCents, monthWindow(today).daysLeft);
  const need = needWords(standing);
  const short = standing.standingCents !== null && standing.standingCents < 0;
  return (
    <HeroFigure label="After everything this month">
      <span className={short ? "text-spending" : standing.standingCents === null ? "text-muted" : "text-income"}>
        {sentence ?? "—"}
      </span>
      {need && (
        <span className="block max-w-md font-sans text-[15px] font-normal text-muted">
          Income minus what the month needs ({need}), minus <Money cents={standing.extrasCents} className="text-foreground" /> of
          spending the plan does not cover.
        </span>
      )}
    </HeroFigure>
  );
}

/** How much of Spent is not sorted yet, so it shows in no line's figure. */
function UnsortedNote({ actuals, everything }: { actuals: PlannedData["actuals"]; everything: boolean }) {
  const unsorted = actuals.unsortedCents;
  if (unsorted === null || unsorted === 0) return null;
  return (
    <span className="block font-sans text-[15px] font-normal text-muted">
      {everything ? "includes " : "plus "}
      <Money cents={unsorted} className="text-foreground" /> not sorted yet{everything ? "" : ", counted on no tab"}
    </span>
  );
}

/** Both views' totals, when checking started and, on a business tab, where its Misc spending is sorted. */
function HeroNote({ data }: { data: PlannedData }) {
  const misc = data.tab.kind === "business" ? data.actuals.miscCount : 0;
  return (
    <div className="max-w-sm text-pretty pb-1.5 text-[15px] text-muted">
      <p>
        Monthly <Money cents={data.monthlyCents} className="text-foreground" />, annual{" "}
        <Money cents={data.annualCents} className="text-foreground" />. Each view shows only its own items.
      </p>
      {data.startDate !== null && <p className="mt-1">Spending is checked from {formatShortDate(data.startDate, true)} on.</p>}
      {misc > 0 && (
        <p className="mt-1">
          <span className="font-semibold text-spending">! {plural(misc, "transaction")} in Misc</span> for all businesses,{" "}
          <Link href={`${budgetHref(EXPENSES)}#misc`} className="underline underline-offset-4">
            sorted on Expenses
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function currentView(data: PlannedData, mode: PlannedMode, change: ViewChange): BudgetView {
  const options = { period: change.period ?? data.period, by: change.by ?? data.by };
  if (data.tab.kind === "business") return { kind: "business", businessId: data.tab.businessId, ...options };
  const personalOnly = change.personalOnly ?? data.tab.personalOnly;
  return { kind: mode === "expenses" ? "expenses" : "planned", personalOnly, ...options };
}
