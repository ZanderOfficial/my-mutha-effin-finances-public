import { describe, expect, it } from "vitest";
import { formatMonth, formatShortDate, plural } from "./format";

describe("formatShortDate", () => {
  it("formats without time zone drift", () => {
    expect(formatShortDate("2026-06-12")).toBe("Jun 12");
    expect(formatShortDate("2026-01-01", true)).toBe("Jan 1, 2026");
    expect(formatShortDate("2026-12-31")).toBe("Dec 31");
  });
  it("leaves unrecognised text alone", () => {
    expect(formatShortDate("soon")).toBe("soon");
    expect(formatShortDate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("formatMonth", () => {
  it("names a YYYY-MM month, short or long", () => {
    expect(formatMonth("2026-03")).toBe("Mar");
    expect(formatMonth("2026-12", true)).toBe("December");
  });
  it("leaves unrecognised text alone", () => {
    expect(formatMonth("2026-13")).toBe("2026-13");
    expect(formatMonth("March")).toBe("March");
  });
});

describe("plural", () => {
  it("counts", () => {
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(0, "day")).toBe("0 days");
  });
});
