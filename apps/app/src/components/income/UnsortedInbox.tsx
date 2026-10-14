"use client";
// "To sort" on the Income tab: deposits nothing has decided yet, one row per source, each marked income or not in one action.

import { useState } from "react";
import { markSourceAction } from "@/app/budget/sorting-actions";
import { Money } from "@/components/Money";
import { Column, MoneyCell } from "@/components/table/DataTable";
import { ExpandButton } from "@/components/table/Disclosure";
import { AlwaysBox, DecideCell, InboxSection, inboxFormId, PickRows, useInbox, type Inbox } from "@/components/table/inbox";
import { CLIP_WIDE, GUTTER, GUTTER_BUTTON_MIDDLE, INBOX_NAME, INBOX_SUBLINE, NESTED_ROW, NUM, ROW, ROW_BUTTON, TAG, TD, TD_EDIT } from "@/components/table/styles";
import { sortedNote } from "@/lib/budget-table";
import { cn } from "@/lib/cn";
import { formatShortDate, plural } from "@/lib/format";
import { depositsWaiting, type Business, type UnsortedSource } from "@/lib/sorting";

const SECTION_ID = "unsorted";
/** Source (with its ▸), Total, Deposits, Latest, For, and Always with Income and Not income. */
const COLUMNS = 6;

export function UnsortedInbox({ sources, businesses }: { sources: UnsortedSource[]; businesses: Business[] }) {
  const inbox = useInbox(SECTION_ID);
  return (
    <InboxSection
      id={SECTION_ID}
      inbox={inbox}
      count={depositsWaiting(sources)}
      unit="deposit"
      intro={
        <>
          Deposits Plaid could not call income or not. They count nowhere until you sort them.
          {businesses.length === 0 && " Add a business below to tag income to it."}
        </>
      }
      label="Deposits to sort, by source"
      noun="sources"
      columns={COLUMNS}
      head={<UnsortedHead />}
      items={sources}
      keyOf={(source) => source.sourceKey}
    >
      {(source, index) => <SourceRows source={source} index={index} businesses={businesses} inbox={inbox} />}
    </InboxSection>
  );
}

/** On a phone the row fits without scrolling: the source with its total, count and date under it, For, then the decision. */
function UnsortedHead() {
  return (
    <thead>
      <tr>
        <Column kind="text" className={cn("w-full", GUTTER)}>
          Source
        </Column>
        <Column kind="money" end className="max-md:hidden">
          Total
        </Column>
        <Column kind="count" end className="max-md:hidden">
          Deposits
        </Column>
        <Column kind="date" className="max-md:hidden">
          Latest
        </Column>
        <Column kind="select" className="max-md:w-28 max-md:min-w-28 md:min-w-36">
          For
        </Column>
        <Column srOnly>Always, and decide</Column>
      </tr>
    </thead>
  );
}

/** One source: its row, then its deposits, each with a tick box once Always is unticked. */
function SourceRows({ source, index, businesses, inbox }: { source: UnsortedSource; index: number; businesses: Business[]; inbox: Inbox }) {
  const [always, setAlways] = useState(true);
  const [open, setOpen] = useState(false);
  const formId = inboxFormId("unsorted", source.sourceKey);
  const depositsId = `${formId}-deposits`;
  const note = (data: FormData) => sortedNote({ source: source.label, outcome: outcomeWords(data, businesses), always, unit: "deposit" });
  const job = { action: markSourceAction, key: source.sourceKey, label: source.label, index, note };
  const busy = inbox.pending && inbox.active === source.sourceKey;
  // Unticking Always opens the deposits, each ticked; folding them away keeps the ticks.
  const untickAlways = (value: boolean) => {
    setAlways(value);
    if (!value) setOpen(true);
  };

  return (
    <tbody aria-busy={busy || undefined} className={busy ? "opacity-60" : ""}>
      <tr className={ROW}>
        <td className={cn(TD, "relative w-full max-md:max-w-0", GUTTER)}>
          <ExpandButton expanded={open} controls={depositsId} label={`Deposits from ${source.label}`} onToggle={() => setOpen(!open)} className={GUTTER_BUTTON_MIDDLE} />
          <span className={INBOX_NAME} title={source.label}>
            {source.label}
          </span>
          <span className={INBOX_SUBLINE}>
            <Money cents={source.totalCents} /> · {source.count} · {formatShortDate(source.latestDate)}
          </span>
        </td>
        <MoneyCell cents={source.totalCents} className="max-md:hidden" />
        <td className={`${TD} ${NUM} max-md:hidden`}>{source.count}</td>
        <td className={`${TD} text-muted max-md:hidden`}>{formatShortDate(source.latestDate)}</td>
        <ForCell formId={formId} label={source.label} businesses={businesses} />
        <DecideCell formId={formId} onSubmit={inbox.submit(job)}>
          <input type="hidden" form={formId} name="sourceKey" value={source.sourceKey} />
          <AlwaysBox formId={formId} always={always} onChange={untickAlways} words={`decide ${source.label} this way`} firstControl={businesses.length === 0} />
          <DecideButtons formId={formId} label={source.label} disabled={inbox.pending} />
        </DecideCell>
      </tr>
      {!always && <PickRows id={depositsId} hidden={!open} formId={formId} colSpan={COLUMNS} rows={source.rows} unit="deposit" />}
      {always && open && <DepositRows id={depositsId} source={source} />}
    </tbody>
  );
}

/** Who the income is for. Without businesses every deposit is personal, so nothing is asked. */
function ForCell({ formId, label, businesses }: { formId: string; label: string; businesses: Business[] }) {
  if (businesses.length === 0) {
    return (
      <td className={TD}>
        <span className={TAG}>Personal</span>
      </td>
    );
  }
  return (
    <td className={cn(TD_EDIT, "max-md:w-28 max-md:min-w-28")}>
      <select form={formId} name="businessId" defaultValue="" aria-label={`Who income from ${label} is for`} data-first-control className="cell-input cell-select">
        <option value="">Personal</option>
        {businesses.map((business) => (
          <option key={business.id} value={business.id}>
            {business.name}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="cell-chevron">
        ▾
      </span>
    </td>
  );
}

function DecideButtons({ formId, label, disabled }: { formId: string; label: string; disabled: boolean }) {
  return (
    <>
      <button type="submit" form={formId} name="kind" value="income" disabled={disabled} className={cn(ROW_BUTTON, "border-income text-income")}>
        Income<span className="sr-only">: {label}</span>
      </button>
      <button type="submit" form={formId} name="kind" value="not_income" disabled={disabled} className={ROW_BUTTON}>
        Not income<span className="sr-only">: {label}</span>
      </button>
    </>
  );
}

/** With Always ticked, the ▸ only shows the deposits; nothing to tick. */
function DepositRows({ id, source }: { id: string; source: UnsortedSource }) {
  return (
    <tr id={id} className={NESTED_ROW}>
      <td colSpan={COLUMNS} className="border-b border-rule/60 py-1 pl-11 pr-2.5">
        <table className="w-full border-separate border-spacing-0 text-[14px]">
          <caption className="sr-only">{plural(source.count, "deposit")} from {source.label}</caption>
          <tbody>
            {source.rows.map((deposit) => (
              <tr key={deposit.id}>
                <td className={`${TD} w-28 text-muted`}>{formatShortDate(deposit.date, true)}</td>
                <td className={`${TD} w-full max-md:max-w-0`}>
                  <span className={CLIP_WIDE} title={deposit.name}>
                    {deposit.name}
                  </span>
                  {deposit.pending && <span className="ml-2 text-[13px] text-muted">pending</span>}
                </td>
                <td className={`${TD} ${NUM}`}>
                  <Money cents={deposit.amountCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

/** What the pressed button did, in words: "marked income for Studio" or "marked not income". */
function outcomeWords(data: FormData, businesses: Business[]): string {
  if (data.get("kind") !== "income") return "marked not income";
  const business = businesses.find((b) => b.id === data.get("businessId"));
  return business ? `marked income for ${business.name}` : "marked income";
}
