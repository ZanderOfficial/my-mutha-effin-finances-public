"use client";
// Places a native popover (menu or picker) beside the button that opened it, and reports when it closes.

import { useEffect, useRef } from "react";

const GAP_PX = 4;

/**
 * The browser opens and closes the popover (popovertarget, Escape and clicking away all work with no
 * script); this only positions it under its button, flipping above when there is no room, moves
 * focus into it, closes it when the page or a table scrolls under it, and calls `onClose` when it shuts.
 */
export function usePopoverAnchor<Button extends HTMLElement>({ onClose }: { onClose?: () => void } = {}) {
  const buttonRef = useRef<Button>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closed = useRef(onClose);

  useEffect(() => {
    closed.current = onClose;
  });

  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    // A popover sits still while its button scrolls away, so any scroll outside it closes it.
    const closeOnScroll = (event: Event) => {
      if (popover.contains(event.target as Node)) return;
      popover.hidePopover();
    };
    const stopWatching = () => document.removeEventListener("scroll", closeOnScroll, { capture: true });
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") {
        openBeside(popover, buttonRef.current);
        document.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });
        return;
      }
      stopWatching();
      closed.current?.();
    };
    popover.addEventListener("toggle", onToggle);
    return () => {
      popover.removeEventListener("toggle", onToggle);
      stopWatching();
    };
  }, []);

  return { buttonRef, popoverRef };
}

function openBeside(popover: HTMLElement, button: HTMLElement | null) {
  if (button) place(popover, button.getBoundingClientRect());
  popover.querySelector<HTMLElement>("button, input, select, a[href]")?.focus({ preventScroll: true });
}

/** Right edges aligned, below the button, or above it when the window has no room below. */
function place(popover: HTMLElement, from: DOMRect) {
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.max(GAP_PX, Math.min(from.right - width, window.innerWidth - width - GAP_PX));
  const below = from.bottom + GAP_PX;
  const top = below + height > window.innerHeight ? Math.max(GAP_PX, from.top - height - GAP_PX) : below;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

/** Closes the popover a control sits in, before that control does its work. */
export function closeOwnPopover(control: HTMLElement) {
  control.closest<HTMLElement>("[popover]")?.hidePopover();
}
