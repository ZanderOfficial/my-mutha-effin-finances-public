"use client";
// When a row is deleted, focus moves to the row that took its place and a line under the table says what went.

import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { focusTargetAfter } from "./focus";

const Announce = createContext<(words: string) => void>(() => {});

/** Wraps a table whose rows can be deleted, with the status line that outlives them. */
export function RemovalNotice({ children }: { children: ReactNode }) {
  const [words, setWords] = useState("");
  return (
    <Announce value={setWords}>
      {children}
      <p role="status" className="text-[14px] text-muted [&:not(:empty)]:mt-2">
        {words && (
          <>
            <span aria-hidden="true">✓ </span>
            {words}
          </>
        )}
      </p>
    </Announce>
  );
}

type Armed = { words: string; next: HTMLElement | null };

/**
 * Arms a row's removal when its delete is sent. If the row then leaves the page, focus moves to
 * where it was worked out to go and the table says `words`; a refused delete leaves the row, so nothing happens.
 */
export function useRemoval() {
  const announce = use(Announce);
  const armed = useRef<Armed | null>(null);

  useEffect(() => {
    const pending = armed;
    return () => {
      const removal = pending.current;
      if (!removal) return;
      announce(removal.words);
      removal.next?.focus();
    };
  }, [announce]);

  return {
    arm: (from: HTMLElement, scope: "row" | "group", words: string) => {
      armed.current = { words, next: focusTargetAfter(from, scope) };
    },
    disarm: () => {
      armed.current = null;
    },
  };
}
