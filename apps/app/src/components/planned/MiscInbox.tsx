"use client";
// "To sort" on the Expenses tab: spending that fits no line item yet, one row per merchant, and each charge sortable on its own.

import { useState } from "react";
import { sortMerchantAction } from "@/app/budget/spending-actions";
import { Money } from "@/components/Money";
import { Column, MoneyCell } from "@/components/table/DataTable";
import { ExpandButton } from "@/components/table/Disclosure";
import {
  AlwaysBox,
  DecideCell,
  FieldsRow,
  InboxSection,
  inboxFormId,
  inboxStatusId,
  NestedField,
  useInbox,
  type Inbox,
} from "@/components/table/inbox";
import { INBOX_NAME, INBOX_SUBLINE, NESTED_INPUT, NESTED_ROW, NUM, PRIMARY_BUTTON, ROW, ROW_BUTTON, TD, TD_EDIT } from "@/components/table/styles";
import type { MiscTransaction } from "@/lib/actuals";
import { sortedNote, sortRequest } from "@/lib/budget-table";
import { cn } from "@/lib/cn";
import { formatShortDate } from "@/lib/format";
import { centsToDollarsInput } from "@/lib/money-input";
import type { Business, OneTimeKind, SourceGroup } from "@/lib/sorting";
import type { TaxCategory } from "@/lib/tax-categories";
import { CategoryOptions, FrequencyOptions, OneTimeKindOptions } from "./options";

type Merchant = SourceGroup<MiscTransaction>;
type Choices = { items: { id: string; label: string }[]; businesses: Business[]; categories: TaxCategory[]; oneTimeKinds: OneTimeKind[] };

const SECTION_ID = "misc";
/** Merchant, Spent, Txns, Latest, Sort to, and Always with the Sort button. */
const COLUMNS = 6;

export function MiscInbox({ merchants, count, since, choices }: { merchants: Merchant[]; count: number; since: string | null; choices: Choices }) {
  const inbox = useInbox(SECTION_ID);
  return (
    <InboxSection
      id={SECTION_ID}
      inbox={inbox}
      count={count}
      unit="transaction"
      intro={`Spending${since ? ` since ${formatShortDate(since)}` : ""} that matches no line item yet. Sort a merchant once; tick Always and it stays sorted. Open its charges to send any one somewhere else.`}
      label="Spending to sort, by merchant"
      noun="merchants"
      columns={COLUMNS}
      head={<MiscHead />}
      items={merchants}
      keyOf={(merchant) => merchant.sourceKey}
    >
      {(merchant, index) => <MerchantRows merchant={merchant} index={index} choices={choices} inbox={inbox} />}
    </InboxSection>
  );
}

/** On a phone the row fits without scrolling: the merchant with its spent, count and date under it, Sort to, then Always and Sort. */
function MiscHead() {
  return (
    <thead>
      <tr>
        <Column kind="text" className="w-full">
          Merchant
        </Column>
        <Column kind="money" end className="max-md:hidden">
          Spent
        </Column>
        <Column kind="count" end className="max-md:hidden">
          Txns
        </Column>
        <Column kind="date" className="max-md:hidden">
          Latest
        </Column>
        <Column kind="select" className="max-md:w-32 max-md:min-w-32 md:min-w-52">
          Sort to
        </Column>
        <Column srOnly>Always, and sort</Column>
      </tr>
    </thead>
  );
}

/** One merchant: its row, the fields its choice needs, and its charges when Always is unticked. */
function MerchantRows({ merchant, index, choices, inbox }: { merchant: Merchant; index: number; choices: Choices; inbox: Inbox }) {
  const [always, setAlways] = useState(true);
  const [choice, setChoice] = useState("");
  const [open, setOpen] = useState(false);
  const chargesId = `${inboxFormId("misc", merchant.sourceKey)}-charges`;
  const formId = inboxFormId("misc", merchant.sourceKey);
  const request = sortRequest(choice);
  const note = sortedNote({ source: merchant.label, outcome: `sorted to ${targetWords(choice, choices.items)}`, always, unit: "charge" });
  const job = { action: sortMerchantAction, key: merchant.sourceKey, label: merchant.label, index, note: () => note };
  const refused = inbox.state.status === "error" && inbox.state.key === merchant.sourceKey;
  const busy = inbox.pending && inbox.active === merchant.sourceKey;

  return (
    <tbody aria-busy={busy || undefined} className={busy ? "opacity-60" : ""}>
      <tr className={ROW}>
        <td className={`${TD} w-full max-md:max-w-0`}>
          <span className={INBOX_NAME} title={merchant.label}>
            {merchant.label}
          </span>
          <span className={INBOX_SUBLINE}>
            <Money cents={merchant.totalCents} /> · {merchant.count} · {formatShortDate(merchant.latestDate)}
          </span>
          {merchant.rows.some((row) => row.usualCents !== undefined) && (
            <span className="block text-[13px] font-semibold text-spending">! A large purchase, so it waits for you</span>
          )}
          <ExpandButton expanded={open || !always} controls={chargesId} onToggle={() => setOpen(!open)} className="-ml-2 text-[13px]">
            Sort each charge<span className="sr-only"> from {merchant.label}</span>
          </ExpandButton>
        </td>
        <MoneyCell cents={merchant.totalCents} className="max-md:hidden" />
        <td className={`${TD} ${NUM} max-md:hidden`}>{merchant.count}</td>
        <td className={`${TD} text-muted max-md:hidden`}>{formatShortDate(merchant.latestDate)}</td>
        <td className={cn(TD_EDIT, "max-md:w-32 max-md:min-w-32")}>
          <SortToSelect formId={formId} merchant={merchant} items={choices.items} choice={choice} onChoose={setChoice} refused={refused} />
        </td>
        <DecideCell formId={formId} onSubmit={inbox.submit(job)}>
          <AlwaysBox formId={formId} always={always} onChange={setAlways} words={`sort ${merchant.label} this way`} />
          <button
            type="submit"
            form={formId}
            name="do"
            value={request.do}
            disabled={inbox.pending}
            className={choice === "new" ? PRIMARY_BUTTON : ROW_BUTTON}
          >
            {choice === "new" ? "Make and sort" : "Sort"}
            <span className="sr-only"> {merchant.label}</span>
          </button>
        </DecideCell>
      </tr>
      <OffPlanFields formId={formId} hidden={choice !== "out" && choice !== "one"} oneTime={choice === "one"} choices={choices} />
      <NewItemFields formId={formId} hidden={choice !== "new"} merchant={merchant} choices={choices} />
      <EachCharge id={chargesId} formId={formId} merchant={merchant} items={choices.items} always={always} hidden={!open && always} />
    </tbody>
  );
}

/** One choice for the whole merchant: a line item, Out of budget, One-time, or a new line item made from it. */
function SortToSelect({
  formId,
  merchant,
  items,
  choice,
  onChoose,
  refused,
}: {
  formId: string;
  merchant: Merchant;
  items: Choices["items"];
  choice: string;
  onChoose: (choice: string) => void;
  refused: boolean;
}) {
  const request = sortRequest(choice);
  return (
    <>
      <input type="hidden" form={formId} name="sourceKey" value={merchant.sourceKey} />
      <input type="hidden" form={formId} name="itemTarget" value={request.itemTarget} />
      <select
        value={choice}
        onChange={(event) => onChoose(event.target.value)}
        aria-label={`Sort ${merchant.label} to`}
        aria-invalid={refused || undefined}
        aria-describedby={refused ? inboxStatusId(SECTION_ID) : undefined}
        data-first-control
        className="cell-input cell-select"
      >
        <option value="" disabled>
          Choose where it goes…
        </option>
        {items.length > 0 && (
          <optgroup label="Line items">
            {items.map((item) => (
              <option key={item.id} value={`item:${item.id}`}>
                {item.label}
              </option>
            ))}
          </optgroup>
        )}
        <option value="out">Out of budget</option>
        <option value="one">One-time (won&rsquo;t repeat)</option>
        <option value="transfer">Transfer between my accounts</option>
        <option value="new">New line item…</option>
      </select>
      <span aria-hidden="true" className="cell-chevron">
        ▾
      </span>
    </>
  );
}

/**
 * Every charge from the merchant, each with its own place (the owner, 2026-10-10): "Same as above" goes
 * with the merchant's choice; anything else is that charge's own choice, which beats any rule. Folded
 * rows still post "Same as above", so a closed list sorts exactly as the merchant row says.
 */
function EachCharge({
  id,
  formId,
  merchant,
  items,
  always,
  hidden,
}: {
  id: string;
  formId: string;
  merchant: Merchant;
  items: Choices["items"];
  always: boolean;
  hidden: boolean;
}) {
  return (
    <>
      <tr id={id} hidden={hidden} className={NESTED_ROW}>
        <td colSpan={COLUMNS} className="border-b border-rule/60 px-2.5 py-2 text-[13px] text-muted">
          {always
            ? "Always is on: the merchant gets a rule, and any charge sent elsewhere here is its exception."
            : "Always is off: only these charges are decided. The next one from here will ask again."}
        </td>
      </tr>
      {merchant.rows.map((row) => (
        <tr key={row.id} hidden={hidden} className={NESTED_ROW}>
          <td colSpan={COLUMNS - 2} className="border-b border-rule/60 px-2.5 text-[14px]">
            <span className="flex min-h-11 items-center gap-3">
              <span className="w-24 shrink-0 text-muted">{formatShortDate(row.date, true)}</span>
              <span className="min-w-0 flex-1 truncate" title={row.name}>
                {row.name}
              </span>
              {row.pending && <span className="text-[13px] text-muted">pending</span>}
              {row.usualCents !== undefined && <LargeNote usualCents={row.usualCents} />}
              <Money cents={row.amountCents} className="tabular-nums" />
            </span>
          </td>
          <td colSpan={2} className={cn(TD_EDIT, "border-b border-rule/60")}>
            <select
              form={formId}
              name={`each:${row.id}`}
              defaultValue="same"
              aria-label={`${formatShortDate(row.date, true)}, ${row.name}: sort to`}
              className="cell-input cell-select"
            >
              <option value="same">Same as above</option>
              {!always && <option value="skip">Leave in Misc</option>}
              {items.length > 0 && (
                <optgroup label="Line items">
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="out">Out of budget</option>
              <option value="one">One-time (won&rsquo;t repeat)</option>
              <option value="transfer">Transfer between my accounts</option>
              <option value="not_spending">Not spending (it came back)</option>
            </select>
          </td>
        </tr>
      ))}
    </>
  );
}

/** Why a charge from a merchant the app has learned still waits here: it is at least twice the usual. */
function LargeNote({ usualCents }: { usualCents: number }) {
  return (
    <span className="shrink-0 text-[13px] font-semibold text-spending">
      ! Large: your usual is <Money cents={usualCents} />
    </span>
  );
}

/** Out of budget and one-time can still be tagged: who it was for, where it lands for tax, and for one-time what it was. */
function OffPlanFields({ formId, hidden, oneTime, choices }: { formId: string; hidden: boolean; oneTime: boolean; choices: Choices }) {
  return (
    <FieldsRow colSpan={COLUMNS} hidden={hidden}>
      {oneTime && choices.oneTimeKinds.length > 0 && (
        <NestedField label="What it was" htmlFor={`${formId}-one-kind`} className="w-full sm:w-44">
          <select id={`${formId}-one-kind`} form={formId} name="outOneTimeKindId" defaultValue="" className={NESTED_INPUT}>
            <OneTimeKindOptions kinds={choices.oneTimeKinds} />
          </select>
        </NestedField>
      )}
      {choices.businesses.length > 0 && (
        <NestedField label="For" htmlFor={`${formId}-out-for`} className="w-full sm:w-44">
          <select id={`${formId}-out-for`} form={formId} name="outBusinessId" defaultValue="" className={NESTED_INPUT}>
            <option value="">Personal</option>
            {choices.businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </NestedField>
      )}
      <NestedField label="Tax category" htmlFor={`${formId}-out-category`} className="w-full sm:w-56">
        <select id={`${formId}-out-category`} form={formId} name="outTaxCategoryId" defaultValue="" className={NESTED_INPUT}>
          <CategoryOptions categories={choices.categories} />
        </select>
      </NestedField>
    </FieldsRow>
  );
}

/** "New line item…": filled in with the merchant's name and its latest real amount, ready to change. */
function NewItemFields({ formId, hidden, merchant, choices }: { formId: string; hidden: boolean; merchant: Merchant; choices: Choices }) {
  const id = (field: string) => `${formId}-new-${field}`;
  return (
    <FieldsRow colSpan={COLUMNS} hidden={hidden}>
      <NestedField label="Name" htmlFor={id("name")} className="w-full sm:w-56">
        <input id={id("name")} form={formId} name="newName" defaultValue={merchant.label.slice(0, 120)} maxLength={120} autoComplete="off" className={NESTED_INPUT} />
      </NestedField>
      <NestedField label="Amount" htmlFor={id("amount")} className="w-32">
        <input
          id={id("amount")}
          form={formId}
          name="newAmount"
          inputMode="decimal"
          defaultValue={centsToDollarsInput(merchant.rows[0].amountCents)}
          autoComplete="off"
          className={`${NESTED_INPUT} text-right tabular-nums`}
        />
      </NestedField>
      <NestedField label="Frequency" htmlFor={id("frequency")} className="w-32">
        <select id={id("frequency")} form={formId} name="newFrequency" defaultValue="monthly" className={NESTED_INPUT}>
          <FrequencyOptions />
        </select>
      </NestedField>
      <NestedField label="Tax category" htmlFor={id("category")} className="w-full sm:w-56">
        <select id={id("category")} form={formId} name="newTaxCategoryId" defaultValue="" className={NESTED_INPUT}>
          <CategoryOptions categories={choices.categories} />
        </select>
      </NestedField>
      {choices.businesses.length > 0 && <ForChecks formId={formId} businesses={choices.businesses} />}
    </FieldsRow>
  );
}

function ForChecks({ formId, businesses }: { formId: string; businesses: Business[] }) {
  return (
    <fieldset>
      <legend className="mb-1 text-[13px] text-muted">For (none ticked is personal)</legend>
      <div className="flex flex-wrap gap-x-4">
        {businesses.map((business) => (
          <label key={business.id} className="inline-flex min-h-11 items-center gap-2 text-[14px]">
            <input type="checkbox" form={formId} name="newBusinessId" value={business.id} className="size-5 accent-foreground" />
            {business.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Where the choice sends the merchant, in words for the line it leaves behind. */
function targetWords(choice: string, items: Choices["items"]): string {
  if (choice === "out") return "Out of budget";
  if (choice === "one") return "One-time";
  if (choice === "transfer") return "Transfer between my accounts";
  if (choice === "new") return "a new line item";
  const target = sortRequest(choice).itemTarget;
  return items.find((item) => item.id === target)?.label ?? "a line item";
}
