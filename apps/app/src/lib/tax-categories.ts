// The owner's tax categories: the starting set from their spreadsheet, how a mapping is written, and totals' labels.
import type { GroupTotal } from "./planned-budget";

/** The Schedule C year the starting set's proposed lines come from (reference.schedule_c_lines). */
export const STARTING_SET_YEAR = 2025;

/**
 * The owner's spreadsheet list, offered once as a starting set. Each carries a proposed Schedule C
 * line, "personal", or nothing where the owner should decide. Proposals stay unconfirmed until the
 * owner (or their accountant) confirms them; the app never says whether anything is deductible.
 */
export const STARTING_CATEGORIES: { name: string; proposed: string | "personal" | null }[] = [
  { name: "Accounting", proposed: "17" },
  { name: "Advertising", proposed: "8" },
  { name: "Answering Service", proposed: "27b" },
  { name: "Car / Truck / Expense - Fuel", proposed: "9" },
  { name: "Car / Truck / Expense - Repairs", proposed: "9" },
  { name: "Car / Truck / Expense - Loan Payment", proposed: null },
  { name: "Bank Charges", proposed: "27b" },
  { name: "Continued Education", proposed: "27b" },
  { name: "Commissions Paid", proposed: "10" },
  { name: "Delivery & Freight", proposed: "27b" },
  { name: "Dues / Subscriptions", proposed: "27b" },
  { name: "Employee Benefit", proposed: "14" },
  { name: "Gifts", proposed: "27b" },
  { name: "Insurance - Auto", proposed: "9" },
  { name: "Insurance - Health Ins for employees", proposed: "14" },
  { name: "Interest Expenses", proposed: "16b" },
  { name: "Janitorial", proposed: "27b" },
  { name: "Legal and Professional", proposed: "17" },
  { name: "Licenses & Permits", proposed: "23" },
  { name: "Meals", proposed: "24b" },
  { name: "Office Expense / Internet", proposed: "18" },
  { name: "Outside Services / Contractors (1099)", proposed: "11" },
  { name: "Parking and Tolls", proposed: "9" },
  { name: "Rent - Office Space", proposed: "20b" },
  { name: "Rent - Equipment", proposed: "20a" },
  { name: "Rent - Vehicle Lease", proposed: "20a" },
  { name: "Repairs and Maintenance", proposed: "21" },
  { name: "Salaries & Wages - (Non Owner W-2s)", proposed: "26" },
  { name: "Owner Wages (Reported on W2)", proposed: null },
  { name: "Security", proposed: "27b" },
  { name: "Supplies", proposed: "22" },
  { name: "Taxes - Real Estate", proposed: "23" },
  { name: "Taxes - Payroll", proposed: "23" },
  { name: "Taxes - Personal Property", proposed: "23" },
  { name: "Taxes - Other", proposed: "23" },
  { name: "Telephone", proposed: "25" },
  { name: "Tools | Software", proposed: "18" },
  { name: "Travel", proposed: "24a" },
  { name: "Uniforms", proposed: "27b" },
  { name: "Utilities", proposed: "25" },
  { name: "Other: Vet Visit", proposed: "personal" },
  { name: "Other: Dog Grooming", proposed: "personal" },
  { name: "Other: Dog Toy / Treats", proposed: "personal" },
  { name: "Other: Doctors Visit", proposed: "personal" },
  { name: "Other: Recreational", proposed: "personal" },
];

/** One Schedule C expense line, as printed on the form. */
export type ScheduleCLine = { year: number; line: string; heading: string | null; label: string };

/** One tax year's lines, with where they were copied from and when that was checked. */
export type ScheduleCForm = { year: number; sourceUrl: string; checkedOn: string; lines: ScheduleCLine[] };

export type TaxCategory = {
  id: string;
  name: string;
  mapping: Mapping;
  /** False while the mapping is only the app's proposal. */
  confirmed: boolean;
  /** The line it maps to, when it maps to one. */
  line: ScheduleCLine | null;
};

/** "Line 16a · Interest (see instructions): Mortgage (paid to banks, etc.)", the form's own words. */
export function lineName(line: ScheduleCLine): string {
  return `Line ${line.line} · ${line.heading ? `${line.heading} ` : ""}${line.label}`;
}

/** Where a category goes on the return. */
export type Mapping = { kind: "line"; year: number; line: string } | { kind: "personal" } | { kind: "unmapped" };

/** A mapping as one form value: "line:2025:16a", "personal" or "". */
export function mappingValue(mapping: Mapping): string {
  if (mapping.kind === "line") return `line:${mapping.year}:${mapping.line}`;
  return mapping.kind === "personal" ? "personal" : "";
}

/** Reads a mapping form value back, or null when it is not one. */
export function parseMapping(value: unknown): Mapping | null {
  if (value === "" || value === null || value === undefined) return { kind: "unmapped" };
  if (value === "personal") return { kind: "personal" };
  const match = typeof value === "string" ? /^line:(\d{4}):(\d{1,2}[a-z]?)$/.exec(value) : null;
  return match ? { kind: "line", year: Number(match[1]), line: match[2] } : null;
}

export type TotalsBy = "category" | "line";

export type LabelledTotal = { label: string; totalCents: number; muted: boolean };

/** The key a category's spending is totalled under by line: "2025:18", "personal", or null when not on a line. */
export function lineKeyFor(categories: TaxCategory[]): (categoryId: string | null) => string | null {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return (categoryId) => {
    const category = categoryId ? byId.get(categoryId) : undefined;
    if (category?.line) return lineKey(category.line);
    return category?.mapping.kind === "personal" ? "personal" : null;
  };
}

/** Names each total for the screen: a category by its name, a line in the form's own words. */
export function labelTotals(groups: GroupTotal[], by: TotalsBy, categories: TaxCategory[]): LabelledTotal[] {
  const names = by === "category" ? categoryNames(categories) : lineNames(categories);
  return groups.map((group) => ({
    label: (group.key !== null && names.get(group.key)) || unlabelled(by, group.key),
    totalCents: group.totalCents,
    muted: group.key === null || group.key === "personal",
  }));
}

function categoryNames(categories: TaxCategory[]): Map<string, string> {
  return new Map(categories.map((category) => [category.id, category.name]));
}

function lineNames(categories: TaxCategory[]): Map<string, string> {
  return new Map(categories.flatMap((category) => (category.line ? [[lineKey(category.line), lineName(category.line)]] : [])));
}

const lineKey = (line: ScheduleCLine) => `${line.year}:${line.line}`;

function unlabelled(by: TotalsBy, key: string | null): string {
  if (by === "category") return "No tax category";
  return key === "personal" ? "Personal, not on Schedule C" : "Not on a Schedule C line yet";
}
