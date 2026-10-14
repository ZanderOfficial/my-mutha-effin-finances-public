// The option lists the planned tables' selects share.
import type { OneTimeKind } from "@/lib/sorting";
import type { TaxCategory } from "@/lib/tax-categories";

export function FrequencyOptions() {
  return (
    <>
      <option value="monthly">Monthly</option>
      <option value="annual">Annual</option>
    </>
  );
}

/** The owner's tax categories, with "None" first. */
export function CategoryOptions({ categories }: { categories: TaxCategory[] }) {
  return (
    <>
      <option value="">None</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </>
  );
}

/** The owner's one-time kinds, with "No kind" first. */
export function OneTimeKindOptions({ kinds }: { kinds: OneTimeKind[] }) {
  return (
    <>
      <option value="">No kind</option>
      {kinds.map((kind) => (
        <option key={kind.id} value={kind.id}>
          {kind.name}
        </option>
      ))}
    </>
  );
}

export const FREQUENCY_WORD = { monthly: "Monthly", annual: "Annual" } as const;
