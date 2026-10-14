import { describe, expect, it } from "vitest";
import { depositsWaiting, groupBySource, type UnsortedDeposit } from "./sorting";

// Tiny synthetic deposits; they exist only in this file.
let seq = 0;
const deposit = (sourceKey: string, date: string, amountCents: number, label = sourceKey): UnsortedDeposit => ({
  id: `d${++seq}`,
  date,
  name: `${label} ${seq}`,
  label,
  amountCents,
  pending: false,
  sourceKey,
});

describe("groupBySource", () => {
  it("counts and totals each source, labelled by its latest deposit", () => {
    const [client] = groupBySource([
      deposit("client one", "2026-03-01", 20000, "Client One Old"),
      deposit("client one", "2026-05-01", 30000, "Client One"),
    ]);
    expect(client).toMatchObject({ sourceKey: "client one", label: "Client One", count: 2, totalCents: 50000 });
    expect(client.latestDate).toBe("2026-05-01");
    expect(client.rows.map((d) => d.date)).toEqual(["2026-05-01", "2026-03-01"]);
  });

  it("puts the biggest total first", () => {
    const sources = groupBySource([
      deposit("small", "2026-01-01", 1000),
      deposit("large", "2026-01-02", 90000),
      deposit("small", "2026-01-03", 2000),
    ]);
    expect(sources.map((s) => s.sourceKey)).toEqual(["large", "small"]);
  });

  it("returns nothing for no deposits", () => {
    expect(groupBySource([])).toEqual([]);
  });
});

describe("depositsWaiting", () => {
  it("counts the deposits behind every source, not their money", () => {
    expect(depositsWaiting([{ count: 2 }, { count: 3 }])).toBe(5);
    expect(depositsWaiting([])).toBe(0);
  });
});
