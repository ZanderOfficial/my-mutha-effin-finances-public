// The planned items as one database table: a <tbody> per item with its sub-items, "+ New item", Out of budget, totals.
import { Money } from "@/components/Money";
import { Column, DataTable, EmptyRow, StateText } from "@/components/table/DataTable";
import { RemovalNotice } from "@/components/table/removal";
import { FOOT, GUTTER, NUM, SPENT_EDGE, STICKY_FIRST } from "@/components/table/styles";
import { planVerdict } from "@/lib/budget-table";
import { cn } from "@/lib/cn";
import { itemChoices, type PlannedView } from "@/lib/planned-budget";
import type { PlannedData } from "@/server/reports";
import { AFTER_STANDING, notesColumn, plannedColumnCount } from "./columns";
import { ItemGroup } from "./ItemGroup";
import { NewItemRows } from "./NewItemRows";
import { OutOfBudgetGroup } from "./OutOfBudgetGroup";
import { PlannedProvider, type PlannedTableData } from "./PlannedContext";

/** What every planned row, and the Expenses list, reads from the tab's data. */
export function plannedContext(data: PlannedData): PlannedTableData {
  const { actuals } = data;
  return {
    period: data.period,
    businesses: data.businesses,
    categories: data.categories,
    oneTimeKinds: data.oneTimeKinds,
    actuals: { period: actuals.period, actualByItem: actuals.actualByItem, matchedByItem: actuals.matchedByItem },
    // Spending can go to any line item, whatever this tab shows.
    itemChoices: itemChoices(data.allItems),
    businessId: data.tab.kind === "business" ? data.tab.businessId : null,
  };
}

export function PlannedTable({ data, title }: { data: PlannedData; title: string }) {
  const { budget, actuals, period } = data;
  return (
    <PlannedProvider value={plannedContext(data)}>
      <RemovalNotice>
        <DataTable
          label={`${title}: planned items against what was spent`}
          minWidth="md:min-w-[1180px]"
          scrolls="laptop"
          hint="For, Tax category, Status and Notes"
        >
          <PlannedHead period={period} />
          {budget.rows.length === 0 ? (
            <EmptyRow colSpan={plannedColumnCount(period)}>{emptyWords(title, budget.totalCents !== null)}</EmptyRow>
          ) : (
            budget.rows.map((row) => <ItemGroup key={row.item.id} row={row} />)
          )}
          {data.canEdit && <NewItemRows />}
          {actuals.outOfBudgetCents !== null && actuals.outOfBudget.length > 0 && (
            <OutOfBudgetGroup transactions={actuals.outOfBudget} cents={actuals.outOfBudgetCents} />
          )}
          {actuals.oneTimeCents !== null && actuals.oneTime.length > 0 && (
            <OutOfBudgetGroup kind="one_time" transactions={actuals.oneTime} cents={actuals.oneTimeCents} byKind={actuals.oneTimeByKind} />
          )}
          {actuals.transfers.length > 0 && (
            <OutOfBudgetGroup kind="transfer" transactions={actuals.transfers} cents={-actuals.transfers.reduce((total, t) => total + t.amountCents, 0)} />
          )}
          {actuals.notSpending.length > 0 && (
            <OutOfBudgetGroup kind="not_spending" transactions={actuals.notSpending} cents={-actuals.notSpending.reduce((total, t) => total + t.amountCents, 0)} />
          )}
          <PlannedFoot data={data} />
        </DataTable>
      </RemovalNotice>
    </PlannedProvider>
  );
}

/** Nothing invented: with nothing entered it is "Nothing here yet"; a view that filters everything out says so. */
function emptyWords(title: string, entered: boolean): string {
  return entered ? `Nothing in ${title} for this view yet.` : "Nothing here yet.";
}

function PlannedHead({ period }: { period: PlannedView }) {
  return (
    <thead>
      <tr>
        <Column kind="text" className={cn(STICKY_FIRST, GUTTER, "z-20")}>
          Name
        </Column>
        <Column kind="money" end className="min-w-20 md:min-w-24">
          Amount
        </Column>
        <Column kind="select" className="min-w-24 max-md:hidden">
          Freq
        </Column>
        {period === "annual" && (
          <Column kind="computed" end>
            Planned
          </Column>
        )}
        <Column kind="relation" end className={SPENT_EDGE}>
          Spent
        </Column>
        <Column kind="computed">Standing</Column>
        <Column kind="tags" className="min-w-28">
          For
        </Column>
        <Column kind="select" className="min-w-28">
          Tax category
        </Column>
        <Column kind="status">Status</Column>
        <Column kind="text" className={cn("min-w-24", notesColumn(period))}>
          Notes
        </Column>
        <Column srOnly className="w-18 min-w-18">
          Save state
        </Column>
        <Column srOnly className="w-11">
          Row menu
        </Column>
      </tr>
    </thead>
  );
}

/**
 * Planned, spent and how the plan stands, all straight from the lib totals. Standing leaves out Out of budget
 * and not-paying items' spending, so it names what it compares when Spent shows more. On a phone it rides under Spent.
 */
function PlannedFoot({ data }: { data: PlannedData }) {
  const { budget, actuals, period } = data;
  const annual = period === "annual";
  const { verdict, comparedCents } = planVerdict(budget.totalCents, actuals);
  const planned = <FootMoney cents={budget.totalCents} />;
  return (
    <tfoot>
      <tr className="font-semibold">
        <th scope="row" className={cn(FOOT, STICKY_FIRST, GUTTER, "text-left")}>
          {annual ? "Annual total" : "Monthly total"}
        </th>
        {annual ? <td className={FOOT} /> : planned}
        <td className={`${FOOT} max-md:hidden`} />
        {annual && planned}
        <td className={cn(FOOT, NUM, SPENT_EDGE, actuals.totalCents === null && "text-muted")}>
          <Money cents={actuals.totalCents} />
          {/* A zero-width line that runs left from the figure's edge, so it never widens the Spent column. */}
          {verdict && (
            <span aria-hidden="true" className="flex justify-end text-[13px] md:hidden">
              <span className="flex w-0 justify-end">
                <StateText state={verdict} className="whitespace-nowrap" />
              </span>
            </span>
          )}
        </td>
        <td className={FOOT}>
          {verdict && <StateText state={verdict} />}
          {comparedCents !== null && (
            <span className="block text-[13px] font-normal text-muted">
              vs <Money cents={comparedCents} /> on paying items
            </span>
          )}
        </td>
        <td colSpan={AFTER_STANDING} className={FOOT} />
      </tr>
    </tfoot>
  );
}

function FootMoney({ cents }: { cents: number | null }) {
  return (
    <td className={cn(FOOT, NUM, cents === null && "text-muted")}>
      <Money cents={cents} />
    </td>
  );
}

