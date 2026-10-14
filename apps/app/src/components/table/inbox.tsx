"use client";
// What the two "To sort" inboxes share: the section and its table, one action for the whole table, a ghost line where a sorted row was, and focus that follows.

import { Fragment, useActionState, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { submitWith } from "@/components/ActionForm";
import { Money } from "@/components/Money";
import { formatShortDate, plural } from "@/lib/format";
import type { ActionState } from "@/server/owner-write";
import { DataTable } from "./DataTable";
import { focusRowAt } from "./focus";
import type { RowAction } from "./RowForm";
import { ALERT_PILL, CELL, NESTED_ROW, ROW_BUTTON, SECTION_HEADING } from "./styles";

/** Rows shown before "Show all". */
const FIRST_SHOWN = 8;

/** One sort: the action, which source it was, where it sat, and the line it leaves behind (which can depend on the button pressed). */
export type SortJob = { action: RowAction; key: string; label: string; index: number; note: (data: FormData) => string };

type InboxState = ActionState & { seq: number; key: string | null; label: string; index: number; note: string };

const START: InboxState = { status: "idle", message: "", seq: 0, key: null, label: "", index: 0, note: "" };

async function runSort(previous: InboxState, job: SortJob & { data: FormData }): Promise<InboxState> {
  const result = await job.action({ status: "idle", message: "" }, job.data);
  return { ...result, seq: previous.seq + 1, key: job.key, label: job.label, index: job.index, note: job.note(job.data) };
}

/** Words of lowercase letters and digits with single spaces: hyphens for spaces lose nothing. */
const PLAIN_KEY = /^[a-z0-9]+( [a-z0-9]+)*$/;

/**
 * A source's form id, e.g. "misc-corner-cafe". A key that hyphens would blur (punctuation, capitals,
 * double spaces) also gets "_" and a short hash of the key, so two such keys never share an id.
 */
export function inboxFormId(prefix: string, sourceKey: string): string {
  const slug = `${prefix}-${sourceKey.replace(/\W+/g, "-")}`;
  return PLAIN_KEY.test(sourceKey) ? slug : `${slug}_${shortHash(sourceKey)}`;
}

/** FNV-1a over the key's UTF-16 units, in base 36: stable across renders and server and client. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The id of an inbox's status line, which a refused choice points at. */
export const inboxStatusId = (sectionId: string) => `${sectionId}-status`;

/**
 * One action state for the whole inbox: the sorted row leaves the list on success, so its own state
 * would vanish with it. After a sort, keyboard focus moves to the row that took its place.
 */
export function useInbox(sectionId: string) {
  const [state, dispatch, pending] = useActionState(runSort, START);
  const [active, setActive] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(0);

  // Focus follows the list: the row now in the sorted one's place, or the "All sorted" line.
  useEffect(() => {
    if (state.status !== "saved") return;
    const section = document.getElementById(sectionId);
    if (!focusRowAt(section, state.index)) section?.querySelector<HTMLElement>("[data-inbox-done]")?.focus();
  }, [state, sectionId]);

  const submit = (job: SortJob) => (event: FormEvent<HTMLFormElement>) => {
    setActive(job.key);
    submitWith((data) => dispatch({ ...job, data }))(event);
  };
  const ghost = state.status === "saved" && dismissed !== state.seq ? { seq: state.seq, index: state.index, note: state.note } : null;
  return { state, pending, active, ghost, submit, dismissGhost: setDismissed };
}

export type Inbox = ReturnType<typeof useInbox>;

/**
 * An inbox: "To sort" and its count, the status line, the table of rows (the first eight, then
 * "Show all"), and the ghost line of the last sort where its row was. Once the last row is sorted
 * it stays as one "All sorted" line until the page is loaded again; an inbox empty from the start shows nothing.
 */
export function InboxSection<T>({
  id,
  inbox,
  count,
  unit,
  intro,
  label,
  noun,
  columns,
  head,
  items,
  keyOf,
  children: renderRows,
}: {
  id: string;
  inbox: Inbox;
  /** How many transactions wait, from the lib. */
  count: number;
  unit: "transaction" | "deposit";
  intro: ReactNode;
  /** Names the table for screen readers. */
  label: string;
  /** "merchants" or "sources", for "Show all 12 merchants". */
  noun: string;
  columns: number;
  head: ReactNode;
  items: T[];
  keyOf: (item: T) => string;
  /** One item's rows, at its place in the list. */
  children: (item: T, index: number) => ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const [hadRows] = useState(items.length > 0);
  if (items.length === 0) return hadRows ? <InboxDone id={id} state={inbox.state} /> : null;

  const shown = showAll ? items : items.slice(0, FIRST_SHOWN);
  const { ghost } = inbox;
  const ghostRow = ghost && <GhostRow key={ghost.seq} colSpan={columns} note={ghost.note} onDone={() => inbox.dismissGhost(ghost.seq)} />;
  return (
    <section id={id} aria-labelledby={`${id}-heading`} data-inbox className="mb-12">
      <InboxHeading id={`${id}-heading`} count={count} unit={unit}>
        {intro}
      </InboxHeading>
      <InboxStatus id={inboxStatusId(id)} state={inbox.state} />
      <DataTable label={label}>
        {head}
        {shown.map((item, index) => (
          <Fragment key={keyOf(item)}>
            {ghost?.index === index && ghostRow}
            {renderRows(item, index)}
          </Fragment>
        ))}
        {ghost && ghost.index >= shown.length && ghostRow}
      </DataTable>
      {!showAll && items.length > FIRST_SHOWN && (
        <button type="button" onClick={() => setShowAll(true)} className={`mt-3 ${ROW_BUTTON}`}>
          Show all {items.length} {noun}
        </button>
      )}
    </section>
  );
}

/** After the last sort: the status line saying what happened, and a line that takes focus. */
function InboxDone({ id, state }: { id: string; state: InboxState }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mb-12">
      <h2 id={`${id}-heading`} className={`mb-2 ${SECTION_HEADING}`}>
        To sort
      </h2>
      <InboxStatus id={inboxStatusId(id)} state={state} />
      <p tabIndex={-1} data-inbox-done className="text-[14px] text-muted">
        <span aria-hidden="true">✓ </span>All sorted.
      </p>
    </section>
  );
}

/** The inbox's one live line: what the last sort did, or the server's words when it refused. */
function InboxStatus({ id, state }: { id: string; state: InboxState }) {
  return (
    <p id={id} role="status" className="min-h-6 text-[14px]">
      {state.status === "saved" && <span className="text-income">✓ {state.note}</span>}
      {state.status === "error" && (
        <span className="text-spending">
          ! {state.label}: {state.message}
        </span>
      )}
    </p>
  );
}

/**
 * Where a sorted row was: one muted line that folds away and is then removed (the status line says
 * it to screen readers). It waits while the pointer is over the table, so rows never move under a click.
 */
function GhostRow({ colSpan, note, onDone }: { colSpan: number; note: string; onDone: () => void }) {
  return (
    <tbody aria-hidden="true">
      <tr>
        <td colSpan={colSpan} className="border-b border-rule/60 p-0">
          <div className="ghost-collapse" onAnimationEnd={onDone}>
            <div>
              <p className="flex min-h-11 items-center gap-2 px-2.5 text-[14px] text-muted">
                <span className="text-income">✓</span>
                {note}
              </p>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  );
}

/**
 * A row's last cell: its form, Always, and the buttons that decide it. On a phone they stack, so
 * the row fits without scrolling.
 */
export function DecideCell({ formId, onSubmit, children }: { formId: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode }) {
  return (
    <td className={`${CELL} whitespace-nowrap pl-1 pr-1.5`}>
      <form id={formId} onSubmit={onSubmit} />
      <div className="flex items-center justify-end gap-1.5 max-md:flex-col max-md:items-stretch max-md:py-1">{children}</div>
    </td>
  );
}

/** Ticked from the start (the owner's choice). Unticked, it posts nothing, which means one at a time. */
export function AlwaysBox({
  formId,
  always,
  onChange,
  words,
  firstControl,
}: {
  formId: string;
  always: boolean;
  onChange: (always: boolean) => void;
  /** Read after "Always", e.g. "sort Corner Cafe this way". */
  words: string;
  /** Whether keyboard focus lands here after a sort, when the row has no choice before it. */
  firstControl?: boolean;
}) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 px-1.5 text-[13px] text-muted">
      <input
        type="checkbox"
        form={formId}
        name="always"
        value="1"
        checked={always}
        onChange={(event) => onChange(event.target.checked)}
        data-first-control={firstControl || undefined}
        className="size-5 accent-foreground"
      />
      Always<span className="sr-only"> {words}</span>
    </label>
  );
}

type Pickable = { id: string; date: string; name: string; amountCents: number; pending: boolean };

/**
 * With Always unticked, the source's rows open underneath, each ticked; only the ticked ones are
 * decided. A missing "always" means exactly this, never a rule.
 */
export function PickRows({
  id,
  hidden = false,
  formId,
  colSpan,
  rows,
  unit,
}: {
  /** The first nested row's id, for the ▸ that folds them. Folded rows still post their ticks. */
  id?: string;
  hidden?: boolean;
  formId: string;
  colSpan: number;
  rows: Pickable[];
  unit: "charge" | "deposit";
}) {
  return (
    <>
      <tr id={id} hidden={hidden} className={NESTED_ROW}>
        <td colSpan={colSpan} className="border-b border-rule/60 px-2.5 py-2 text-[13px] text-muted">
          Always is off, so only the ticked {unit}s are decided. The next one from here will ask again.
        </td>
      </tr>
      {rows.map((row) => (
        <PickRow key={row.id} formId={formId} colSpan={colSpan} row={row} hidden={hidden} />
      ))}
    </>
  );
}

/** One ticked row; its label (date, name, amount) is what names the tick box. */
function PickRow({ formId, colSpan, row, hidden }: { formId: string; colSpan: number; row: Pickable; hidden: boolean }) {
  return (
    <tr hidden={hidden} className={NESTED_ROW}>
      <td colSpan={colSpan} className="border-b border-rule/60 p-0">
        <label className="flex min-h-11 items-center gap-3 px-2.5 text-[14px]">
          <input type="checkbox" form={formId} name="transactionId" value={row.id} defaultChecked className="size-5 accent-foreground" />
          <span className="w-28 shrink-0 text-muted">{formatShortDate(row.date, true)}</span>
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          {row.pending && <span className="text-[13px] text-muted">pending</span>}
          <Money cents={row.amountCents} className="tabular-nums" />
        </label>
      </td>
    </tr>
  );
}

/** A row of labelled fields nested under an inbox row, for a choice that needs more than one value. */
export function FieldsRow({ colSpan, hidden, children }: { colSpan: number; hidden: boolean; children: ReactNode }) {
  return (
    <tr hidden={hidden} className={NESTED_ROW}>
      <td colSpan={colSpan} className={`${CELL} px-2.5 py-3`}>
        <div className="flex flex-wrap items-end gap-3">{children}</div>
      </td>
    </tr>
  );
}

/** A small visible label above a nested field. */
export function NestedField({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-[13px] text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/** "To sort", the count that needs the owner, and one plain line about what the rows are. */
function InboxHeading({ id, count, unit, children }: { id: string; count: number; unit: string; children: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 id={id} className={SECTION_HEADING}>
        To sort
      </h2>
      <span aria-hidden="true" className={ALERT_PILL}>
        ! {count}
      </span>
      <span className="sr-only">{plural(count, unit)} to sort.</span>
      <p className="text-pretty text-[14px] text-muted">{children}</p>
    </div>
  );
}
