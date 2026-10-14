"use client";
// A cell with one quiet button that posts one action, such as Undo or Unassign, and says how it went.

import { useActionState, type ReactNode } from "react";
import { submitWith } from "@/components/ActionForm";
import { cn } from "@/lib/cn";
import type { ActionState } from "@/server/owner-write";
import type { RowAction } from "./RowForm";
import { CELL_BUTTON } from "./styles";

const IDLE: ActionState = { status: "idle", message: "" };

/** The fields are posted as hidden inputs; `children` is the button's words, with any screen-reader detail. */
export function ActionCell({
  action,
  fields,
  children,
  className,
}: {
  action: RowAction;
  fields: Record<string, string>;
  children: ReactNode;
  className?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  return (
    <td className={cn("h-11 border-b border-rule/60 px-1 text-right align-middle", className)}>
      <form onSubmit={submitWith(dispatch)} className="inline-flex items-center justify-end gap-2">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <span role="status" className={`text-[13px] ${state.status === "error" ? "text-spending" : "text-muted"}`}>
          {state.status === "error" ? `! ${state.message}` : ""}
        </span>
        <button type="submit" disabled={pending} className={CELL_BUTTON}>
          {pending ? "Saving…" : children}
        </button>
      </form>
    </td>
  );
}
