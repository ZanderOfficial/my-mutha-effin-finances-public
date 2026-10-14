"use client";
// The owner's own list for breaking down one-time spending (Eating out, Clothes, ...), edited like Businesses.

import { addOneTimeKindAction, removeOneTimeKindAction, renameOneTimeKindAction } from "@/app/budget/spending-actions";
import { NameList, type NameListSpec } from "@/components/table/NameList";
import type { OneTimeKind } from "@/lib/sorting";

const SPEC: NameListSpec = {
  noun: "one-time kind",
  label: "One-time kinds",
  idField: "kindId",
  prefix: "one-time-kind",
  placeholder: "Eating out, Clothes…",
  removeWords: "Its purchases stay one-time, with no kind.",
  add: addOneTimeKindAction,
  rename: renameOneTimeKindAction,
  remove: removeOneTimeKindAction,
};

export function OneTimeKinds({ kinds }: { kinds: OneTimeKind[] }) {
  return (
    <>
      <p className="mb-3 max-w-2xl text-pretty text-[14px] text-muted">
        What your one-time purchases were. Each one-time charge can name one, and the Ledger&rsquo;s One-time group adds them up by kind.
        The tax category still says where a purchase lands for tax.
      </p>
      <NameList spec={SPEC} items={kinds} />
    </>
  );
}
