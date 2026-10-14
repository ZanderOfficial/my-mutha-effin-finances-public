"use client";
// One table row's form: its cells post the whole row through a server action and hear back in the row.

import {
  createContext,
  startTransition,
  use,
  useActionState,
  useEffect,
  useRef,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { submitWith } from "@/components/ActionForm";
import { changedFields, formSnapshot, savedAfter, savedSelectValue, type FieldValue, type SavedValues } from "@/lib/budget-table";
import { cn } from "@/lib/cn";
import type { ActionState } from "@/server/owner-write";
import { ROW } from "./styles";

export type RowAction = (previous: ActionState, form: FormData) => Promise<ActionState>;

/**
 * The server's answer, numbered so a repeat answer still restarts the "Saved" fade; the cell that
 * sent it; the cells a refusal marks (every one changed and not yet saved); how many saves there were;
 * and the values last saved, which tell a changed select from a saved one.
 */
export type RowState = ActionState & { seq: number; field: string | null; invalid: string[]; saves: number; saved: SavedValues };

export type CommitOptions = {
  /** Another of the row's actions, such as stop paying or delete; the row's own action by default. */
  action?: RowAction;
  /** Fields the action needs that no cell holds, such as the new status. */
  extra?: Record<string, string>;
  /** The cell that asked. */
  field?: string | null;
};

type Job = { action: RowAction; data: FormData; field: string | null; changed: string[] };

type RowContextValue = {
  state: RowState;
  actions: {
    commit: (options?: CommitOptions) => void;
    submit: (event: FormEvent<HTMLFormElement>) => void;
    /** A draft row's leave check: whether anything was typed into it yet. */
    hasTypedText: () => boolean;
    /** Attaches the row's <form> element, which sits in its status cell. */
    attachForm: (form: HTMLFormElement | null) => void;
  };
  meta: { formId: string; pending: boolean; draft: boolean };
};

const RowContext = createContext<RowContextValue | null>(null);
const START: RowState = { status: "idle", message: "", seq: 0, field: null, invalid: [], saves: 0, saved: {} };

/** The id of a row's status line, which a refused cell points at with aria-describedby. */
export const rowStatusId = (formId: string) => `${formId}-status`;

/** The row a cell belongs to. */
export function useRow(): RowContextValue {
  const row = use(RowContext);
  if (!row) throw new Error("A table cell must sit inside a RowForm.");
  return row;
}

async function runJob(previous: RowState, job: Job): Promise<RowState> {
  const result = await job.action({ status: previous.status, message: previous.message }, job.data);
  return {
    ...result,
    seq: previous.seq + 1,
    field: job.field,
    invalid: result.status === "error" ? job.changed : [],
    saves: previous.saves + (result.status === "saved" ? 1 : 0),
    saved: savedAfter(previous.saved, job.data.entries(), result.status === "saved"),
  };
}

/**
 * Holds one row's form. Every commit posts every field of the row, so an action that replaces
 * the whole record (updateItem replaces the For tags and the notes) never loses one. A draft row
 * ("+ New") posts only on Enter or when focus leaves it, and clears itself once saved.
 */
export function RowForm({
  id,
  action,
  draft = false,
  children,
}: {
  id: string;
  action: RowAction;
  draft?: boolean;
  children: ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(runJob, START);
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastPosted = useRef<string | null>(null);
  // A draft row empties after each save, so only its rendered defaults count as saved.
  const savedValues = draft ? START.saved : state.saved;

  // After a save, show the saved value in the cell that sent it (unless it is still being typed in);
  // a draft row empties for the next entry. After a refusal, the same values may be sent again.
  useEffect(() => {
    const form = formRef.current;
    if (state.status === "error") {
      lastPosted.current = null;
      return;
    }
    if (!form || state.status !== "saved") return;
    if (draft) {
      form.reset();
      lastPosted.current = null;
      return;
    }
    settleField(form, state.field);
  }, [state, draft]);

  const commit = (options: CommitOptions = {}) => {
    const form = formRef.current;
    if (!form) return;
    const ownAction = !options.action || options.action === action;
    const post = rowPost(form, options, savedValues);
    if (ownAction && isRepeat(post.data, lastPosted)) return;
    // Only an edit marks cells when refused; a refused delete or pause is about the row, not a cell.
    const changed = ownAction || options.field ? post.changed : [];
    startTransition(() => dispatch({ action: options.action ?? action, data: post.data, field: options.field ?? null, changed }));
  };

  // A submit button in the row posts it through the shared submit path.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const changed = changedFields(fieldValues(event.currentTarget, savedValues));
    submitWith((data) => {
      lastPosted.current = formSnapshot(data);
      dispatch({ action, data, field: null, changed });
    })(event);
  };

  const actions = {
    commit,
    submit,
    hasTypedText: () => hasTypedText(formRef.current),
    attachForm: (form: HTMLFormElement | null) => {
      formRef.current = form;
    },
  };
  return <RowContext value={{ state, actions, meta: { formId: id, pending, draft } }}>{children}</RowContext>;
}

/**
 * What a commit posts: every field of the row plus any extras, and the cells that differ from
 * their saved values. A text cell still being typed in, when the commit came from another cell,
 * is sent at its saved value so half-typed text is never saved.
 */
function rowPost(form: HTMLFormElement, options: CommitOptions, saved: SavedValues): { data: FormData; changed: string[] } {
  const data = new FormData(form);
  for (const [name, value] of Object.entries(options.extra ?? {})) data.set(name, value);
  const typing = halfTyped(form, options.field ?? null);
  if (typing) data.set(typing.name, typing.defaultValue);
  const changed = changedFields(fieldValues(form, saved).filter((field) => field.name !== typing?.name));
  return { data, changed };
}

/** The row's text cell that has focus and unsaved text, unless the commit came from it. */
function halfTyped(form: HTMLFormElement, field: string | null): HTMLInputElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || active.form !== form || active.type !== "text") return null;
  if (active.name === field || active.value === active.defaultValue) return null;
  return active;
}

/** Each text cell and select of the row: its value now and the value it was saved with. */
function fieldValues(form: HTMLFormElement, saved: SavedValues): FieldValue[] {
  return [...form.elements].flatMap((element): FieldValue[] => {
    if (element instanceof HTMLSelectElement) {
      return [{ name: element.name, value: element.value, saved: savedSelectValue(element.name, [...element.options], saved) }];
    }
    if (element instanceof HTMLInputElement && element.type === "text") {
      return [{ name: element.name, value: element.value, saved: element.defaultValue }];
    }
    return [];
  });
}

/** True when these exact values were the last ones posted; records them otherwise. */
function isRepeat(data: FormData, lastPosted: RefObject<string | null>): boolean {
  const snapshot = formSnapshot(data);
  if (snapshot === lastPosted.current) return true;
  lastPosted.current = snapshot;
  return false;
}

/** Puts the server's formatting back into a just-saved text cell the owner has left. */
function settleField(form: HTMLFormElement, field: string | null) {
  if (!field) return;
  const control = form.elements.namedItem(field);
  if (!(control instanceof HTMLInputElement) || control === document.activeElement) return;
  control.value = control.defaultValue;
}

function hasTypedText(form: HTMLFormElement | null): boolean {
  if (!form) return false;
  return [...form.elements].some((element) => element instanceof HTMLInputElement && element.type === "text" && element.value.trim() !== "");
}

/** A row of the table. While its save is in flight it dims and says so in its status cell. */
export function Row({
  id,
  ref,
  children,
  className,
  hidden,
}: {
  id?: string;
  ref?: Ref<HTMLTableRowElement>;
  children: ReactNode;
  className?: string;
  hidden?: boolean;
}) {
  const { meta, actions } = useRow();
  // A draft row posts once focus leaves the whole row, if anything was typed into it.
  const postWhenLeft = (event: FocusEvent<HTMLTableRowElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (actions.hasTypedText()) actions.commit();
  };
  return (
    <tr
      id={id}
      ref={ref}
      hidden={hidden}
      onBlur={meta.draft ? postWhenLeft : undefined}
      aria-busy={meta.pending || undefined}
      className={cn(ROW, meta.pending && "opacity-60", className)}
    >
      {children}
    </tr>
  );
}

/** The row's form element and its status: "Saving…", "✓ Saved" that fades, or "! the server's words". */
export function StatusCell({ className, children }: { className?: string; children?: ReactNode }) {
  const { state, actions, meta } = useRow();
  const { attachForm, submit } = actions;
  return (
    <td className={cn("h-11 w-18 min-w-18 border-b border-rule/60 px-2.5 align-middle text-[13px] leading-tight", className)}>
      <form id={meta.formId} ref={attachForm} onSubmit={submit} />
      {children}
      <RowStatus id={rowStatusId(meta.formId)} state={state} pending={meta.pending} />
    </td>
  );
}

/** The words for a row's last save. Also used by an inline confirm strip, which hides the row's own cell. */
export function RowStatus({ id, state, pending }: { id?: string; state: RowState; pending: boolean }) {
  return (
    <span id={id} role="status" className="block whitespace-normal">
      {pending ? <span className="text-muted">Saving…</span> : <SavedOrRefused state={state} />}
    </span>
  );
}

function SavedOrRefused({ state }: { state: RowState }) {
  if (state.status === "error") return <span className="text-spending">! {state.message}</span>;
  if (state.status !== "saved") return null;
  return (
    <span key={state.seq} className="saved-fade text-income">
      ✓ {state.message}
    </span>
  );
}

/** A value the row always posts that no one edits, such as its id. Sits inside a cell. */
export function HiddenField({ name, value }: { name: string; value: string }) {
  const { meta } = useRow();
  return <input type="hidden" form={meta.formId} name={name} value={value} />;
}
