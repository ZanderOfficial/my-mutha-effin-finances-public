// Reads the signed-in owner per request; must never be prerendered.
export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChipRow } from "@/components/Chips";
import { EmptyState } from "@/components/EmptyState";
import { TransactionsTable } from "@/components/Transactions";
import { loadTransactions, type TxFlowFilter } from "@/server/reports";

type Search = Record<string, string | string[] | undefined>;

const FLOWS: { value: TxFlowFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "spending", label: "Spending" },
  { value: "income", label: "Income" },
];

const MAX_QUERY = 100;
const MAX_PAGE = 10_000;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function parseFlow(v: string): TxFlowFilter {
  return v === "spending" || v === "income" ? v : "all";
}

function parsePage(v: string): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PAGE ? n : 1;
}

/** Only non-default values go in the URL, so the plain page has a clean address. */
function href(flow: TxFlowFilter, q: string, page: number): string {
  const p = new URLSearchParams();
  if (flow !== "all") p.set("flow", flow);
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/transactions?${s}` : "/transactions";
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const flow = parseFlow(first(sp.flow));
  const q = first(sp.q).trim().slice(0, MAX_QUERY);
  const page = parsePage(first(sp.page));

  const data = await loadTransactions({ flow, q, page });
  const { total, rows, pageSize } = data;
  const filtered = flow !== "all" || q !== "";
  const from = (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + rows.length;

  return (
    <main id="main" className="flex-1 px-6 py-10 sm:px-10">
      <h1 className="mb-6 font-display text-5xl font-black">Transactions</h1>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <ChipRow
          label="Filter by direction"
          items={FLOWS.map((f) => ({
            label: f.label,
            href: href(f.value, q, 1),
            current: f.value === flow,
          }))}
        />
        <form method="get" action="/transactions" role="search" className="flex min-w-0 flex-1 basis-72 gap-2">
          {flow !== "all" && <input type="hidden" name="flow" value={flow} />}
          <label htmlFor="tx-search" className="sr-only">
            Search merchant or name
          </label>
          <input
            id="tx-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={MAX_QUERY}
            placeholder="Search merchant or name"
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 border-2 border-rule bg-panel px-3 text-[17px] focus:border-foreground"
          />
          <button type="submit" className="min-h-11 border-2 border-foreground px-5 text-[15px] font-bold">
            Search
          </button>
        </form>
      </div>

      {total === null ? (
        <EmptyState
          title="Nothing here yet"
          action={{ href: "/institutions", label: "+ Link an institution" }}
        >
          Every transaction from your linked accounts will be listed here, with search and
          filters.
        </EmptyState>
      ) : total === 0 ? (
        filtered ? (
          <EmptyState title="No transactions match">
            Nothing matches that filter or search. Try All, or a shorter search.
          </EmptyState>
        ) : (
          <EmptyState
            title="Nothing here yet"
            action={{ href: "/institutions", label: "+ Link an institution" }}
          >
            Transactions appear once a linked institution has synced.
          </EmptyState>
        )
      ) : rows.length === 0 ? (
        <EmptyState title="That page is past the end">
          <Link href={href(flow, q, 1)} className="underline underline-offset-4">
            Back to the first page
          </Link>
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-base text-muted" aria-live="polite">
            Showing {from}–{to} of {total.toLocaleString("en-US")}
            {filtered ? " matching" : ""}.
          </p>
          <TransactionsTable rows={rows} />
          <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-3">
            {page > 1 && (
              <Link
                href={href(flow, q, page - 1)}
                className="inline-flex min-h-11 items-center border-2 border-rule px-5 text-[15px] font-bold"
              >
                ← Newer
              </Link>
            )}
            {to < total && (
              <Link
                href={href(flow, q, page + 1)}
                className="inline-flex min-h-11 items-center border-2 border-foreground px-5 text-[15px] font-bold"
              >
                Older →
              </Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
