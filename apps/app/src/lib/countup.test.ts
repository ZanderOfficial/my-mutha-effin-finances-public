import { describe, expect, it } from "vitest";
import { COUNT_UP_MS, easeOutCubic, runCountUp, tweenCents, type FrameClock } from "./countup";
import { formatCents, formatCentsCompact } from "./money";

/** A hand-cranked clock: frames run only when the test says so. */
function fakeClock() {
  let time = 0;
  let nextId = 1;
  const pending = new Map<number, (now: number) => void>();
  const clock: FrameClock = {
    now: () => time,
    request: (cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    cancel: (id) => void pending.delete(id),
  };
  return {
    clock,
    pending: () => pending.size,
    advance(ms: number) {
      time += ms;
      const frames = [...pending.entries()];
      pending.clear();
      for (const [, cb] of frames) cb(time);
    },
  };
}

describe("tweenCents", () => {
  it("starts at zero, ends at the exact final value, and only moves forward", () => {
    expect(tweenCents(123456789, 0)).toBe(0);
    expect(tweenCents(123456789, 1)).toBe(123456789);
    expect(tweenCents(123456789, 5)).toBe(123456789);
    let last = -1;
    for (let p = 0; p <= 1; p += 0.05) {
      const v = tweenCents(123456789, p);
      expect(Number.isSafeInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(123456789);
      last = v;
    }
  });

  it("keeps the sign of a negative figure and never overshoots it", () => {
    for (let p = 0; p <= 1; p += 0.1) {
      const v = tweenCents(-250075, p);
      expect(v).toBeLessThanOrEqual(0);
      expect(v).toBeGreaterThanOrEqual(-250075);
    }
    expect(tweenCents(-250075, 1)).toBe(-250075);
  });

  it("falls back to the final value for unusable input", () => {
    expect(tweenCents(500, Number.NaN)).toBe(500);
    expect(tweenCents(500, Number.POSITIVE_INFINITY)).toBe(500);
    expect(tweenCents(Number.MAX_SAFE_INTEGER, 0.5)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it("eases out and clamps", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("runCountUp", () => {
  const fmt = (c: number) => formatCents(c, { sign: true });

  it("counts up in whole-cent frames and lands on the exact figure", () => {
    const node = { nodeValue: "+$1,234.56" };
    const t = fakeClock();
    let done = 0;
    runCountUp(node, 123456, fmt, t.clock, COUNT_UP_MS, () => (done += 1));
    expect(node.nodeValue).toBe("$0.00");
    const seen: string[] = [];
    for (let i = 0; i < 20 && t.pending() > 0; i++) {
      t.advance(60);
      seen.push(node.nodeValue ?? "");
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.every((s) => /^[+]?\$[\d,]+\.\d{2}$/.test(s))).toBe(true);
    expect(node.nodeValue).toBe("+$1,234.56");
    expect(t.pending()).toBe(0);
    expect(done).toBe(1);
  });

  it("restores the final figure when cancelled mid-run and stops asking for frames", () => {
    const node = { nodeValue: "" };
    const t = fakeClock();
    let done = 0;
    const cancel = runCountUp(node, 99900, formatCentsCompact, t.clock, COUNT_UP_MS, () => (done += 1));
    t.advance(300);
    expect(node.nodeValue).not.toBe("$999.00");
    cancel();
    expect(node.nodeValue).toBe("$999.00");
    expect(t.pending()).toBe(0);
    expect(done).toBe(0);
  });

  it("formats compact figures with the compact formatter every frame", () => {
    const node = { nodeValue: "" };
    const t = fakeClock();
    runCountUp(node, 2_500_000_000, formatCentsCompact, t.clock);
    t.advance(450);
    expect(node.nodeValue).toMatch(/^\$[\d,.]+[MB]?$/);
    t.advance(COUNT_UP_MS);
    expect(node.nodeValue).toBe("$25.0M");
  });
});
