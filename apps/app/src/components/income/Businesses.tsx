"use client";
// The owner's businesses as a table: each renamed in place, removed with an inline confirm, and "+ New business".

import { addBusinessAction, removeBusinessAction, renameBusinessAction } from "@/app/budget/sorting-actions";
import { NameList, type NameListSpec } from "@/components/table/NameList";
import type { Business } from "@/lib/sorting";

const SPEC: NameListSpec = {
  noun: "business",
  label: "Businesses",
  idField: "businessId",
  prefix: "business",
  placeholder: "Business name",
  removeWords: "Its income becomes personal.",
  add: addBusinessAction,
  rename: renameBusinessAction,
  remove: removeBusinessAction,
};

export function Businesses({ businesses }: { businesses: Business[] }) {
  return (
    <>
      <p className="mb-3 max-w-2xl text-pretty text-[14px] text-muted">
        Income and planned costs can be tagged &ldquo;For&rdquo; one of your businesses, and each business gets its own tab. Removing a
        business makes its income personal.
      </p>
      <NameList spec={SPEC} items={businesses} />
    </>
  );
}
