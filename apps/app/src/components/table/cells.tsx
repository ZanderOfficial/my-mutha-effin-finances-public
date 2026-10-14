"use client";
// Editable table cells. Each belongs to its row's form and posts the whole row when it commits.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Business } from "@/lib/sorting";
import { cn } from "@/lib/cn";
import { usePopoverAnchor } from "./popover";
import { rowStatusId, useRow, type CommitOptions, type RowAction } from "./RowForm";
import { GUTTER, TAG, TD_EDIT } from "./styles";

/** Chrome on Windows fires change on every arrow key in a closed select, so selects wait this long. */
const SELECT_SETTLE_MS = 400;

/** Where a name starts: flush, after the gutter that holds a ▸, or further in under its parent with ↳. */
export type NameInset = "none" | "item" | "sub-item";

const NAME_PADDING: Record<NameInset, string> = { none: "", item: GUTTER, "sub-item": "pl-21" };

type TextProps = {
  name: string;
  /** What a screen reader hears, e.g. "Notes for Rent". */
  label: string;
  defaultValue: string;
  maxLength: number;
  required?: boolean;
  placeholder?: string;
  className?: string;
};

/**
 * A row's name, as the row's header: its text input, a ▸ in the gutter for a row with rows under
 * it, ↳ for a sub-item, and on a phone a line underneath repeating a column that is off to the right.
 */
export function NameCell({
  id,
  rowName,
  inset = "none",
  toggle,
  phoneLine,
  className,
  ...text
}: TextProps & {
  /** Lets a draft row focus its name when it opens. */
  id?: string;
  /** The row's name for screen readers, which read it before each cell of the row. */
  rowName: string;
  inset?: NameInset;
  /** The ▸ for rows nested under this one. */
  toggle?: ReactNode;
  /** Shown under the name on a phone only; screen readers read the column it repeats instead. */
  phoneLine?: ReactNode;
}) {
  const { meta, field } = useCellEdit(text.name);
  return (
    <th scope="row" aria-label={rowName} className={cn(TD_EDIT, "text-left font-normal", className)}>
      <InvalidMark invalid={field.invalid} atTop />
      {toggle}
      {inset === "sub-item" && (
        <span aria-hidden="true" className="pointer-events-none absolute left-15 top-0 flex h-11 items-center text-muted">
          ↳
        </span>
      )}
      <input
        id={id}
        placeholder={text.placeholder}
        form={meta.formId}
        name={text.name}
        defaultValue={text.defaultValue}
        aria-label={text.label}
        aria-invalid={field.invalid || undefined}
        aria-describedby={field.errorId}
        maxLength={text.maxLength}
        required={text.required}
        title={text.defaultValue || undefined}
        autoComplete="off"
        data-first-control
        className={cn("cell-input truncate", NAME_PADDING[inset])}
        {...field.events}
      />
      {phoneLine && (
        <span aria-hidden="true" className={cn("block pb-2 pr-2.5 text-[13px] md:hidden", inset === "none" ? "pl-2.5" : GUTTER)}>
          {phoneLine}
        </span>
      )}
    </th>
  );
}

/** A text cell: posts on Enter or when left with a changed value; Escape puts the saved value back. */
export function TextCell({ name, label, defaultValue, maxLength, required, placeholder, className }: TextProps) {
  const { meta, field } = useCellEdit(name);
  return (
    <td className={cn(TD_EDIT, className)}>
      <InvalidMark invalid={field.invalid} />
      <input
        placeholder={placeholder}
        form={meta.formId}
        name={name}
        defaultValue={defaultValue}
        aria-label={label}
        aria-invalid={field.invalid || undefined}
        aria-describedby={field.errorId}
        maxLength={maxLength}
        required={required}
        title={defaultValue || undefined}
        autoComplete="off"
        className="cell-input truncate"
        {...field.events}
      />
    </td>
  );
}

/** A dollars cell. The server reads "$1,850.00", "1850" or "1850.5" alike, as integer cents. */
export function MoneyInputCell({
  name,
  label,
  defaultValue,
  className,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string;
  className?: string;
  placeholder?: string;
}) {
  const { meta, field } = useCellEdit(name);
  return (
    <td className={cn(TD_EDIT, className)}>
      <InvalidMark invalid={field.invalid} />
      <input
        form={meta.formId}
        name={name}
        defaultValue={defaultValue}
        aria-label={label}
        aria-invalid={field.invalid || undefined}
        aria-describedby={field.errorId}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        className="cell-input text-right tabular-nums"
        {...field.events}
      />
    </td>
  );
}

/**
 * A select cell. It posts the row a moment after the choice settles, or at once when focus leaves
 * it, so a choice is never lost; a draft row waits for Enter or leaving the row.
 */
export function SelectCell({
  id,
  name,
  label,
  defaultValue,
  action,
  title,
  description,
  className,
  children,
}: {
  /** Lets a draft row focus this cell when it opens. */
  id?: string;
  name: string;
  label: string;
  defaultValue: string;
  /** Posts through another of the row's actions, such as mapping a tax category. */
  action?: RowAction;
  title?: string;
  /** Fuller words for a screen reader than the option text shows, e.g. the whole Schedule C line. */
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  const { meta, field, commit } = useCellEdit(name);
  const descriptionId = description ? `${meta.formId}-${name}-description` : undefined;
  const settle = useSettled(() => commit({ action, field: name }), SELECT_SETTLE_MS);
  return (
    <td className={cn(TD_EDIT, className)}>
      <InvalidMark invalid={field.invalid} />
      <select
        id={id}
        form={meta.formId}
        name={name}
        defaultValue={defaultValue}
        aria-label={label}
        aria-invalid={field.invalid || undefined}
        title={title}
        aria-describedby={[descriptionId, field.errorId].filter(Boolean).join(" ") || undefined}
        onChange={meta.draft ? undefined : settle.schedule}
        onBlur={settle.flush}
        className="cell-input cell-select"
      >
        {children}
      </select>
      <span aria-hidden="true" className="cell-chevron">
        ▾
      </span>
      {description && (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      )}
    </td>
  );
}

type TagsProps = {
  name: string;
  label: string;
  businesses: Business[];
  checked: string[];
  /** Gives each checkbox a stable id, e.g. "new-for". */
  idPrefix: string;
  /** Shown instead of the tags, e.g. "Shared ×2" on a business tab. */
  summary?: string;
  className?: string;
};

/**
 * The For tags: a button showing the tags, opening a list of businesses to tick. It posts the row
 * when the list closes. None ticked means personal. A draft row starts its ticks afresh after each save.
 */
export function TagsCell(props: TagsProps) {
  const { meta, state } = useRow();
  return <TagsPicker key={meta.draft ? state.saves : 0} {...props} />;
}

function TagsPicker({ name, label, businesses, checked, idPrefix, summary, className }: TagsProps) {
  const { meta, commit } = useCellEdit(name);
  const [ticked, setTicked] = useState(checked);
  const popoverId = `${idPrefix}-popover`;
  const { buttonRef, popoverRef } = usePopoverAnchor<HTMLButtonElement>({ onClose: meta.draft ? undefined : () => commit({ field: name }) });
  const toggle = (id: string, on: boolean) => setTicked((current) => (on ? [...current, id] : current.filter((value) => value !== id)));

  return (
    <td className={cn(TD_EDIT, className)}>
      <button
        ref={buttonRef}
        type="button"
        popoverTarget={popoverId}
        aria-label={`${label}: ${tagWords(businesses, ticked)}`}
        className="cell-input flex items-center gap-1 overflow-hidden text-left"
      >
        <TagList businesses={businesses} ticked={ticked} summary={summary} />
      </button>
      <div ref={popoverRef} id={popoverId} popover="auto" className="anchored-popover w-56">
        <p className="px-2 py-2 text-[13px] text-muted">None ticked is personal.</p>
        {businesses.map((business) => (
          <label key={business.id} htmlFor={`${idPrefix}-${business.id}`} className="flex min-h-11 items-center gap-3 rounded px-2 text-[15px] hover:bg-panel">
            <input
              id={`${idPrefix}-${business.id}`}
              type="checkbox"
              form={meta.formId}
              name={name}
              value={business.id}
              checked={ticked.includes(business.id)}
              onChange={(event) => toggle(business.id, event.target.checked)}
              className="size-5 accent-foreground"
            />
            {business.name}
          </label>
        ))}
      </div>
    </td>
  );
}

function TagList({ businesses, ticked, summary }: { businesses: Business[]; ticked: string[]; summary?: string }) {
  if (summary) return <span className={TAG}>{summary}</span>;
  const names = businesses.filter((business) => ticked.includes(business.id)).map((business) => business.name);
  if (names.length === 0) return <span className={TAG}>Personal</span>;
  return (
    <>
      {names.map((name) => (
        <span key={name} className={TAG}>
          {name}
        </span>
      ))}
    </>
  );
}

function tagWords(businesses: Business[], ticked: string[]): string {
  const names = businesses.filter((business) => ticked.includes(business.id)).map((business) => business.name);
  return names.length === 0 ? "Personal" : names.join(", ");
}

/** The "!" a refused cell carries beside its 2px border, level with the input: centred, or at the top of a name cell. */
function InvalidMark({ invalid, atTop }: { invalid: boolean; atTop?: boolean }) {
  if (!invalid) return null;
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute left-1 z-10 flex h-11 items-center font-bold text-spending", atTop ? "top-0" : "top-[calc(50%-22px)]")}
    >
      !
    </span>
  );
}

/**
 * What every editable cell shares: its row, whether the last refusal marked it (with the id of the
 * words that say why), and its key handling.
 */
function useCellEdit(name: string) {
  const { meta, state, actions } = useRow();
  const invalid = state.status === "error" && state.invalid.includes(name);
  const commit = (options: CommitOptions) => actions.commit(options);
  const events = {
    onBlur: (event: { currentTarget: HTMLInputElement }) => {
      if (meta.draft || event.currentTarget.value === event.currentTarget.defaultValue) return;
      commit({ field: name });
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit({ field: name });
      }
      if (event.key === "Escape") event.currentTarget.value = event.currentTarget.defaultValue;
    },
  };
  return { meta, commit, field: { invalid, errorId: invalid ? rowStatusId(meta.formId) : undefined, events } };
}

/** Runs `run` once calls to `schedule` stop for `delay` ms; `flush` runs a waiting call at once. */
function useSettled(run: () => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    const pending = timer;
    return () => clearPending(pending.current);
  }, []);
  return {
    schedule: () => {
      clearPending(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        latest.current();
      }, delay);
    },
    flush: () => {
      if (timer.current === null) return;
      clearPending(timer.current);
      timer.current = null;
      latest.current();
    },
  };
}

function clearPending(timer: ReturnType<typeof setTimeout> | null) {
  if (timer !== null) clearTimeout(timer);
}
