import { describe, expect, it } from "vitest";
import { incomeByMonth, type IncomeDeposit } from "./income";
import { yearFlow } from "./year-flow";

// Tiny synthetic deposits and charges; they exist only in this file.
let seq = 0;
const deposit = (date: string, amountCents: number, status: IncomeDeposit["status"] = "income"): IncomeDeposit => ({
  id: `d${++seq}`,
  date,
  label: "Client",
  amountCents,
  pending: false,
  status,
  businessId: null,
});
const income = (deposits: IncomeDeposit[]) =>
  incomeByMonth({ year: 2026, today: "2026-03-10", historyStart: "2026-01-01", deposits, filter: { kind: "all" } });
const charge = (date: string, amountCents: number) => ({ date, amountCents });

describe("yearFlow", () => {
  const flow = yearFlow(income([deposit("2026-01-05", 150000), deposit("2026-02-05", 100000), deposit("2026-03-02", 9000, "unsorted")]), [
    charge("2026-01-10", -120000),
    charge("2026-02-11", -130000),
    charge("2026-03-03", -5000),
    charge("2026-03-04", 2000), // money in is never spending
  ]);

  it("keeps made minus spent for each known month, negative when spending ran past income", () => {
    expect(flow.months.slice(0, 3)).toMatchObject([
      { month: "2026-01", madeCents: 150000, spentCents: 120000, keptCents: 30000 },
      { month: "2026-02", madeCents: 100000, spentCents: 130000, keptCents: -30000 },
      { month: "2026-03", state: "partial", madeCents: 0, spentCents: 5000, keptCents: -5000, depositsToSort: 1 },
    ]);
  });

  it("leaves months still to come unknown, never zero", () => {
    expect(flow.months[3]).toMatchObject({ month: "2026-04", madeCents: null, spentCents: null, keptCents: null });
  });

  it("totals the known months and counts the ones that spent more than they made", () => {
    expect(flow).toMatchObject({ madeCents: 250000, spentCents: 255000, keptCents: -5000, overMonths: 2 });
  });

  it("is unknown with no history", () => {
    const empty = yearFlow(incomeByMonth({ year: 2026, today: "2026-03-10", historyStart: null, deposits: [], filter: { kind: "all" } }), []);
    expect(empty).toMatchObject({ madeCents: null, spentCents: null, keptCents: null, overMonths: 0 });
  });
});
