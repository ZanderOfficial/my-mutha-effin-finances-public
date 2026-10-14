// Learning where a merchant's spending goes from the owner's own choices, and spotting a purchase too big to place unasked.
import type { Placement } from "./actuals";

/** The owner's 2026-10-10 thresholds: at least 3 decisions, 90% of them to one place, and 2× the usual is large. */
export const LEARN_MIN_DECISIONS = 3;
export const LEARN_AGREEMENT_PERCENT = 90;
export const LARGE_MULTIPLE = 2;

/** One past decision: where the owner put a charge from this merchant, and how much it was. */
export type Decision = { sourceKey: string; placement: Placement; spentCents: number };

/** What the app learned about one merchant: where its spending usually goes, and its usual (median) charge. */
export type Learned = { placement: Placement | null; usualCents: number };

/**
 * Per merchant: the place at least LEARN_AGREEMENT_PERCENT of its decisions went, once there are at
 * least LEARN_MIN_DECISIONS of them (else null), and the median of the decided charges.
 */
export function learnFromDecisions(decisions: Decision[]): Map<string, Learned> {
  const byMerchant = new Map<string, Decision[]>();
  for (const decision of decisions) byMerchant.set(decision.sourceKey, [...(byMerchant.get(decision.sourceKey) ?? []), decision]);
  return new Map([...byMerchant].map(([sourceKey, merchant]) => [sourceKey, learnedFor(merchant)]));
}

function learnedFor(decisions: Decision[]): Learned {
  const usualCents = median(decisions.map((decision) => decision.spentCents));
  if (decisions.length < LEARN_MIN_DECISIONS) return { placement: null, usualCents };
  const top = mostCommon(decisions);
  const agrees = top.count * 100 >= LEARN_AGREEMENT_PERCENT * decisions.length;
  return { placement: agrees ? top.placement : null, usualCents };
}

/** The place most decisions went, with the latest decision's tags for it. */
function mostCommon(decisions: Decision[]): { placement: Placement; count: number } {
  const counts = new Map<string, { placement: Placement; count: number }>();
  for (const { placement } of decisions) {
    const key = placementKey(placement);
    const seen = counts.get(key);
    counts.set(key, { placement: seen?.placement ?? placement, count: (seen?.count ?? 0) + 1 });
  }
  return [...counts.values()].reduce((best, next) => (next.count > best.count ? next : best));
}

/** Out of budget and one-time are each one place whatever their tags; a line item is its own place. */
function placementKey(placement: Placement): string {
  return placement.kind === "planned_item" ? `item:${placement.plannedItemId}` : placement.kind;
}

/** A charge at least LARGE_MULTIPLE times the merchant's usual is the owner's to decide. */
export function isLarge(spentCents: number, learned: Learned | undefined): boolean {
  return learned !== undefined && learned.usualCents > 0 && spentCents >= LARGE_MULTIPLE * learned.usualCents;
}

/** The middle charge, or the mean of the two middle ones rounded to the cent. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
