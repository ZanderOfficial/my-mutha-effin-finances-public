"use client";
// A row's ⋯ menu, and the inline strip that asks before a delete. No modal, no new dependency.

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { closeOwnPopover, usePopoverAnchor } from "./popover";
import { useRemoval } from "./removal";
import { RowStatus, useRow } from "./RowForm";
import { CELL_BUTTON } from "./styles";

/** The id of a row menu's ⋯ button, where focus comes back to. */
export const menuButtonId = (menuId: string) => `${menuId}-button`;

/** Always visible and muted, a 44px target; the menu opens in the top layer, so no scroll box clips it. */
export function RowMenu({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { buttonRef, popoverRef } = usePopoverAnchor<HTMLButtonElement>();
  return (
    <td className="h-11 w-11 border-b border-rule/60 p-0 text-center align-middle">
      <button id={menuButtonId(id)} ref={buttonRef} type="button" popoverTarget={id} aria-label={label} className={CELL_BUTTON}>
        <span aria-hidden="true">⋯</span>
      </button>
      <div ref={popoverRef} id={id} popover="auto" className="anchored-popover w-60">
        {children}
      </div>
    </td>
  );
}

/** One menu choice. The menu closes first, then the choice runs. */
export function MenuItem({ onSelect, danger, children }: { onSelect: () => void; danger?: boolean; children: ReactNode }) {
  const choose = (event: MouseEvent<HTMLButtonElement>) => {
    closeOwnPopover(event.currentTarget);
    onSelect();
  };
  return (
    <button
      type="button"
      onClick={choose}
      className={`flex min-h-11 w-full items-center rounded px-3 text-left text-[15px] hover:bg-panel focus-visible:bg-panel ${danger ? "text-spending" : "text-foreground"}`}
    >
      {children}
    </button>
  );
}

export function MenuRule() {
  return <hr className="my-1 border-rule" />;
}

/**
 * Takes the place of a row that is about to be deleted: the question, the destructive choice and
 * a way back. Focus starts on the way back, so Enter alone never deletes. Keep returns focus to the
 * row's ⋯ button; once a delete goes through, focus moves to the next row and the table says so.
 */
export function InlineConfirm({
  colSpan,
  question,
  confirmLabel,
  menuId,
  removes = "row",
  gone,
  onConfirm,
  onKeep,
}: {
  colSpan: number;
  question: string;
  confirmLabel: string;
  /** The row's ⋯ menu. */
  menuId: string;
  /** What leaves the table if the server agrees: this row, or the group of rows it heads. */
  removes?: "row" | "group";
  /** What the table says once it has gone, e.g. "Deleted Rent." */
  gone: string;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const { state, meta } = useRow();
  const strip = useRef<HTMLTableRowElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const removal = useRemoval();
  const questionId = `${meta.formId}-question`;

  useEffect(() => {
    keepButton.current?.focus();
  }, []);

  const confirm = () => {
    if (strip.current) removal.arm(strip.current, removes, gone);
    onConfirm();
  };
  const keep = () => {
    removal.disarm();
    onKeep();
    requestAnimationFrame(() => document.getElementById(menuButtonId(menuId))?.focus());
  };

  return (
    <tr ref={strip} className="[&>td]:bg-panel-raised">
      <td colSpan={colSpan} className="h-11 border-b border-rule/60 px-3 py-2">
        <div role="group" aria-labelledby={questionId} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span id={questionId} className="font-semibold">
            {question}
          </span>
          <button
            type="button"
            onClick={confirm}
            disabled={meta.pending}
            className="min-h-11 rounded-md border border-spending px-4 text-[14px] font-semibold text-spending disabled:opacity-50"
          >
            {confirmLabel}
          </button>
          <button ref={keepButton} type="button" onClick={keep} className="min-h-11 rounded-md border border-rule px-4 text-[14px] font-semibold">
            Keep
          </button>
          <span className="text-[13px]">
            <RowStatus state={state} pending={meta.pending} />
          </span>
        </div>
      </td>
    </tr>
  );
}
