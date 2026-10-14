import { describe, expect, it } from "vitest";
import { centsToCellInput, centsToDollarsInput, parseDollarsToCents } from "./money-input";

describe("parseDollarsToCents", () => {
  it("reads whole dollars, cents, a dollar sign and grouping", () => {
    expect(parseDollarsToCents("45")).toBe(4500);
    expect(parseDollarsToCents(" $1,200 ")).toBe(120000);
    expect(parseDollarsToCents("12.5")).toBe(1250);
    expect(parseDollarsToCents("0.99")).toBe(99);
    expect(parseDollarsToCents("0")).toBe(0);
  });
  it("never rounds a float", () => {
    expect(parseDollarsToCents("1.005")).toBeNull();
    expect(parseDollarsToCents("19.99")).toBe(1999);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "abc", "-5", "1e3", "1,20", "1.", ".5", "5 0", "9".repeat(30)]) {
      expect(parseDollarsToCents(bad)).toBeNull();
    }
  });
});

describe("centsToDollarsInput", () => {
  it("round-trips with parseDollarsToCents", () => {
    for (const cents of [0, 5, 99, 4500, 45050, 120000]) {
      expect(parseDollarsToCents(centsToDollarsInput(cents))).toBe(cents);
    }
    expect(centsToDollarsInput(45050)).toBe("450.50");
    expect(centsToDollarsInput(45000)).toBe("450");
  });
});

describe("centsToCellInput", () => {
  it("shows a table cell's dollars grouped with cents, as the server reads them back", () => {
    expect(centsToCellInput(185000)).toBe("$1,850.00");
    expect(centsToCellInput(8550)).toBe("$85.50");
    expect(centsToCellInput(0)).toBe("$0.00");
    for (const cents of [185000, 8550, 0, 100_000_000]) {
      expect(parseDollarsToCents(centsToCellInput(cents))).toBe(cents);
    }
  });
});
