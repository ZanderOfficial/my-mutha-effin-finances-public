/**
 * The load-in count-up for the Overview hero figures. Money stays integer
 * cents the whole way: every frame is a safe integer between 0 and the real
 * value, formatted by the same formatters as the final figure, and the last
 * frame is the real value itself, never a rounded approximation of it.
 */
export const COUNT_UP_MS = 900;

/** Ease-out cubic: fast start, gentle landing. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/**
 * The cents to show at `progress` (0 to 1) on the way to `finalCents`.
 * Progress 1 or more returns `finalCents` exactly; anything unusable returns
 * the final value too, so a bad input can only ever show the right figure.
 */
export function tweenCents(finalCents: number, progress: number): number {
  if (!Number.isSafeInteger(finalCents) || !Number.isFinite(progress) || progress >= 1) {
    return finalCents;
  }
  const value = Math.round(finalCents * easeOutCubic(progress));
  return Number.isSafeInteger(value) ? value : finalCents;
}

/** The slice of a DOM text node the driver touches; lets tests run without a DOM. */
export type TextNodeLike = { nodeValue: string | null };

export type FrameClock = {
  request: (cb: (now: number) => void) => number;
  cancel: (id: number) => void;
  now: () => number;
};

/**
 * Drives one figure from 0 to its final value. Writes `nodeValue` of the text
 * node React rendered (same node, so a later React update still lands on it).
 * Returns a cancel function that stops the animation and puts the final
 * figure back, so an interrupted run (unmount, new props) never leaves a
 * partial number on screen.
 */
export function runCountUp(
  node: TextNodeLike,
  finalCents: number,
  format: (cents: number) => string,
  clock: FrameClock,
  durationMs: number = COUNT_UP_MS,
  onDone?: () => void,
): () => void {
  const finalText = format(finalCents);
  const startedAt = clock.now();
  let frame = 0;
  let done = false;

  const step = (now: number) => {
    const progress = (now - startedAt) / durationMs;
    if (progress >= 1) {
      node.nodeValue = finalText;
      done = true;
      onDone?.();
      return;
    }
    node.nodeValue = format(tweenCents(finalCents, progress));
    frame = clock.request(step);
  };

  node.nodeValue = format(0);
  frame = clock.request(step);

  return () => {
    if (!done) clock.cancel(frame);
    done = true;
    node.nodeValue = finalText;
  };
}
