import { describe, expect, it } from "vitest";
import { addMonthsClamped, monthWindow } from "./month";

// Synthetic dates only.
describe("monthWindow", () => {
  it("counts days elapsed and left, and the progress fraction", () => {
    const w = monthWindow("2026-06-13");
    expect(w.start).toBe("2026-06-01");
    expect(w.endExclusive).toBe("2026-07-01");
    expect(w.daysInMonth).toBe(30);
    expect(w.dayOfMonth).toBe(13);
    expect(w.daysLeft).toBe(17);
    expect(w.progressBps).toBe(4333);
  });

  it("is complete on the last day and just started on the first", () => {
    expect(monthWindow("2026-06-30")).toMatchObject({ daysLeft: 0, progressBps: 10000 });
    expect(monthWindow("2026-06-01")).toMatchObject({ daysLeft: 29, dayOfMonth: 1 });
  });

  it("handles leap and non-leap February", () => {
    expect(monthWindow("2028-02-10").daysInMonth).toBe(29);
    expect(monthWindow("2027-02-10").daysInMonth).toBe(28);
    expect(monthWindow("2028-02-29").endExclusive).toBe("2028-03-01");
  });

  it("rolls over the year boundary in both directions", () => {
    const dec = monthWindow("2026-12-31");
    expect(dec.endExclusive).toBe("2027-01-01");
    const jan = monthWindow("2027-01-05");
    expect(jan.prevStart).toBe("2026-12-01");
    expect(jan.prevSameDayEndExclusive).toBe("2026-12-06");
  });

  it("caps the same day last month at the previous month length", () => {
    // 31 March against a 28-day February: the whole of February.
    const w = monthWindow("2027-03-31");
    expect(w.prevStart).toBe("2027-02-01");
    expect(w.prevSameDayEndExclusive).toBe("2027-03-01");
    expect(monthWindow("2026-06-13").prevSameDayEndExclusive).toBe("2026-05-14");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => monthWindow("2026-6-1")).toThrow(RangeError);
    expect(() => monthWindow("2026-02-30")).toThrow(RangeError);
  });
});

describe("addMonthsClamped", () => {
  it("clamps the day", () => {
    expect(addMonthsClamped("2027-03-31", -1)).toBe("2027-02-28");
    expect(addMonthsClamped("2026-08-31", -6)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-15", -12)).toBe("2025-01-15");
  });
});
