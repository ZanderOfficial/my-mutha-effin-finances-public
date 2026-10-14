"use client";
// The muted "+ New …" line at the foot of a table, which opens that table's draft row.

import { useEffect, useRef, useState } from "react";
import { CELL_BUTTON, TD } from "./styles";

/**
 * Whether the draft row is open. Opening it puts the cursor in `focusId`; closing it with ✕ puts
 * focus back on its "+ New" line (`lineId`), or on `fallbackId` when that line is not shown.
 */
export function useDraftRow(focusId: string, fallbackId?: string) {
  const [open, setOpen] = useState(false);
  const closing = useRef(false);
  const lineId = `${focusId}-line`;

  useEffect(() => {
    if (open) {
      document.getElementById(focusId)?.focus();
      return;
    }
    if (!closing.current) return;
    closing.current = false;
    (document.getElementById(lineId) ?? (fallbackId ? document.getElementById(fallbackId) : null))?.focus();
  }, [open, focusId, lineId, fallbackId]);

  const hide = () => {
    closing.current = true;
    setOpen(false);
  };
  return { open, lineId, show: () => setOpen(true), hide };
}

/** A full-width row holding one quiet button; hidden while the draft row it opens is showing. */
export function NewRowLine({ id, colSpan, label, hidden, onOpen }: { id: string; colSpan: number; label: string; hidden: boolean; onOpen: () => void }) {
  return (
    <tr hidden={hidden}>
      <td colSpan={colSpan} className="h-11 border-b border-rule/60 p-0">
        <button
          id={id}
          type="button"
          onClick={onOpen}
          data-new-row
          className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-[14px] font-semibold text-muted hover:bg-panel-raised hover:text-foreground focus-visible:-outline-offset-2"
        >
          <span aria-hidden="true">+</span> {label}
        </button>
      </td>
    </tr>
  );
}

/** Empty cells that keep a draft row's columns lined up with the rows above it. */
export function BlankCells({ count, className }: { count: number; className?: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <td key={index} className={`${TD} ${className ?? ""}`} />
      ))}
    </>
  );
}

/** ✕ in the menu column of a draft row: closes it without posting. */
export function CancelCell({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <td className="h-11 w-11 border-b border-rule/60 p-0 text-center align-middle">
      <button type="button" onClick={onCancel} aria-label={label} className={CELL_BUTTON}>
        <span aria-hidden="true">✕</span>
      </button>
    </td>
  );
}
