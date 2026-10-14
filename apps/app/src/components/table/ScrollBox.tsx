"use client";
// A table's sideways scroll box that never leaves a focused cell under its sticky first column (WCAG 2.4.11).

import type { FocusEvent, HTMLAttributes } from "react";

/** The browser scrolls a cell into view only when it is off screen; one under the sticky column needs this nudge. */
export function ScrollBox(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} onFocus={keepClearOfSticky} />;
}

function keepClearOfSticky(event: FocusEvent<HTMLDivElement>) {
  const box = event.currentTarget;
  const target = event.target;
  requestAnimationFrame(() => {
    const sticky = box.querySelector<HTMLElement>("thead th");
    if (!sticky || getComputedStyle(sticky).position !== "sticky" || isInStickyCell(target)) return;
    const covered = sticky.getBoundingClientRect().right - target.getBoundingClientRect().left;
    if (covered > 0) box.scrollLeft -= covered;
  });
}

function isInStickyCell(element: Element): boolean {
  const cell = element.closest("th, td");
  return cell !== null && getComputedStyle(cell).position === "sticky";
}
