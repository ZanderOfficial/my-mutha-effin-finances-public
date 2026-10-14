"use client";

import { useLayoutEffect, useRef } from "react";
import { Money } from "@/components/Money";
import { runCountUp } from "@/lib/countup";
import { formatCents, formatCentsCompact } from "@/lib/money";

/**
 * Figures that already counted up in this page load. The count-up is the one
 * orchestrated moment on load (DESIGN.md), so it plays once, not on every
 * client-side navigation back to the Overview.
 */
const played = new Set<string>();

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animates the text node inside `ref` from 0 to `cents` once. The server has
 * already rendered the final text into the HTML, so with no JavaScript, before
 * hydration, with reduced motion, or for an unknown value (null) the final
 * figure is simply what is there. A layout effect starts the run before the
 * first paint after hydration, and its cleanup restores the final figure.
 */
function useCountUp(
  ref: React.RefObject<Element | null>,
  id: string,
  cents: number | null,
  sign: boolean,
  compact: boolean,
) {
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    if (!node || node.nodeType !== 3 || cents === null || cents === 0) return;
    if (played.has(id)) return;
    if (prefersReducedMotion()) {
      played.add(id);
      return;
    }
    const format = (c: number) =>
      compact ? formatCentsCompact(c, { sign }) : formatCents(c, { sign });
    // Marked played only when a run finishes, so React's dev double-invoke
    // (run, cleanup, run) still animates, and a navigation mid-run replays.
    return runCountUp(
      node,
      cents,
      format,
      {
        request: (cb) => window.requestAnimationFrame(cb),
        cancel: (frame) => window.cancelAnimationFrame(frame),
        now: () => performance.now(),
      },
      undefined,
      () => played.add(id),
    );
  }, [ref, id, cents, sign, compact]);
}

type MoneyProps = {
  /** Which figure this is on the page ("income", "spending"); keys the once-only rule. */
  id: string;
  cents: number | null;
  sign?: boolean;
  compact?: boolean;
  className?: string;
};

/**
 * A money figure that counts up on load. The visible digits are aria-hidden
 * and animate; a screen-reader copy of the full final value sits beside them
 * and never changes. A null figure is just <Money>: an em dash, no animation.
 */
export function CountMoney({ id, cents, sign, compact, className }: MoneyProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useCountUp(ref, id, cents, !!sign, !!compact);
  if (cents === null) return <Money cents={null} className={className} />;
  const full = formatCents(cents, { sign });
  const shown = compact ? formatCentsCompact(cents, { sign }) : full;
  return (
    <span className={className} title={shown === full ? undefined : full}>
      <span ref={ref} aria-hidden="true">
        {shown}
      </span>
      <span className="sr-only">{full}</span>
    </span>
  );
}

/** The dial's centre figure (signed gap) as an SVG <text>. The svg's aria-label already says the same in words. */
export function CountSvgText({
  id,
  cents,
  ...textProps
}: { id: string; cents: number } & Omit<React.SVGProps<SVGTextElement>, "children" | "ref">) {
  const ref = useRef<SVGTextElement>(null);
  useCountUp(ref, id, cents, true, false);
  return (
    <text ref={ref} {...textProps}>
      {formatCents(cents, { sign: true })}
    </text>
  );
}
