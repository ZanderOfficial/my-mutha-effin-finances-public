"use client";
// What every row of a planned table reads: the view, the owner's businesses and categories, and real spending.

import { createContext, use, type ReactNode } from "react";
import type { BudgetActuals } from "@/lib/actuals";
import type { PlannedView } from "@/lib/planned-budget";
import type { Business, OneTimeKind } from "@/lib/sorting";
import type { TaxCategory } from "@/lib/tax-categories";

/** Only what a row needs from the actuals: whether they are known, each item's total and its matched charges. */
export type RowActuals = Pick<BudgetActuals, "period" | "actualByItem" | "matchedByItem">;

export type PlannedTableData = {
  period: PlannedView;
  businesses: Business[];
  categories: TaxCategory[];
  /** The owner's own list for breaking down one-time spending. */
  oneTimeKinds: OneTimeKind[];
  actuals: RowActuals;
  /** Every line item, for moving a charge; a sub-item reads "Parent › Sub-item". */
  itemChoices: { id: string; label: string }[];
  /** On a business tab: that business, so a shared cost reads "Shared ×2" and a new item starts tagged. */
  businessId: string | null;
};

const PlannedContext = createContext<PlannedTableData | null>(null);

export function PlannedProvider({ value, children }: { value: PlannedTableData; children: ReactNode }) {
  return <PlannedContext value={value}>{children}</PlannedContext>;
}

export function usePlanned(): PlannedTableData {
  const value = use(PlannedContext);
  if (!value) throw new Error("A planned row must sit inside a PlannedProvider.");
  return value;
}
