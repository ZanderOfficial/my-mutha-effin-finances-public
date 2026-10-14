"use client";
// A form that posts to one Budget page action and says in words whether it worked.

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/server/owner-write";
import { button } from "@/components/Chips";

type Action = (previous: ActionState, form: FormData) => Promise<ActionState>;

const IDLE: ActionState = { status: "idle", message: "" };
const Pending = createContext(false);

/**
 * Submits by hand rather than through `action`, because React clears a form after every action,
 * which would throw away what the owner typed when the save is refused. `resetOnSave` clears it
 * only after a save, for forms that add something new.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSave,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSave?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  const form = useRef<HTMLFormElement>(null);

  // Clear an "add" form once its row exists.
  useEffect(() => {
    if (resetOnSave && state.status === "saved") form.current?.reset();
  }, [state, resetOnSave]);

  return (
    <form ref={form} onSubmit={submitWith(dispatch)} className={className}>
      <Pending value={pending}>{children}</Pending>
      <StatusText state={state} />
    </form>
  );
}

/** A submit handler that posts the form, with the button pressed, without React clearing the form. */
export function submitWith(dispatch: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(data));
  };
}

/** A submit button that is disabled, and says so, while its form is saving. */
export function SubmitButton({
  children,
  className,
  name,
  value,
}: {
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
}) {
  const pending = useContext(Pending);
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={`${button} ${className ?? ""}`}>
      {pending ? "Saving" : children}
    </button>
  );
}

export function StatusText({ state }: { state: ActionState }) {
  return (
    <span role="status" className={`text-sm ${state.status === "error" ? "text-spending" : "text-muted"}`}>
      {state.status === "error" ? `! ${state.message}` : state.status === "saved" ? `✓ ${state.message}` : ""}
    </span>
  );
}
