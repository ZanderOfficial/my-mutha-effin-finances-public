// Reads the signed-in owner per request; must never be prerendered.
export const dynamic = "force-dynamic";

import { AllocationRing, NetWorthChart } from "@/components/Charts";
import { ChipRow, eyebrow } from "@/components/Chips";
import { EmptyState } from "@/components/EmptyState";
import { Money } from "@/components/Money";
import { loanFacts, paymentLabel } from "@/lib/debts";
import { formatShortDate } from "@/lib/format";
import { formatBps } from "@/lib/invest";
import { formatCents } from "@/lib/money";
import { RANGES, parseRange, type Range } from "@/lib/networth";
import { ratioBps } from "@/lib/ratio";
import {
  loadNetWorth,
  type NetWorthData,
  type NetWorthView,
} from "@/server/reports";

type Search = Record<string, string | string[] | undefined>;

const VIEWS: { value: NetWorthView; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "investments", label: "Investments" },
  { value: "debts", label: "Debts" },
];

function parseView(v: string | string[] | undefined): NetWorthView {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "investments" || s === "debts" ? s : "summary";
}

function href(view: NetWorthView, range: Range): string {
  const p = new URLSearchParams();
  if (view !== "summary") p.set("view", view);
  if (range !== "6M") p.set("range", range);
  const s = p.toString();
  return s ? `/net-worth?${s}` : "/net-worth";
}

export default async function NetWorthPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const view = parseView(sp.view);
  const range = parseRange(sp.range);
  const data = await loadNetWorth(view, range);
  const latest = data.latest;

  return (
    <main id="main" className="flex-1 px-6 py-8 sm:px-10">
      <h1 className="sr-only">Net worth</h1>
      <div className="mb-6">
        <div className={eyebrow}>Net worth</div>
        <div className="hero-numeral hero-in">
          <Money cents={latest?.netWorthCents ?? null} compact />
        </div>
        {latest && (
          <p className="mt-2 text-sm text-muted">
            As of {formatShortDate(latest.date, true)}
            {latest.incomplete && (
              <>
                . <span className="text-foreground">! Some balances are unknown, so this may read low.</span>
              </>
            )}
          </p>
        )}
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-x-8 gap-y-3">
        <ChipRow
          label="Net worth views"
          items={VIEWS.map((v) => ({
            label: v.label,
            href: href(v.value, range),
            current: v.value === view,
          }))}
        />
        {view === "summary" && (
          <ChipRow
            label="Time range"
            items={RANGES.map((r) => ({ label: r, href: href(view, r), current: r === range }))}
          />
        )}
      </div>

      {view === "summary" && <Summary data={data} />}
      {view === "investments" && <Investments data={data} />}
      {view === "debts" && <Debts data={data} />}
    </main>
  );
}

function Summary({ data }: { data: NetWorthData }) {
  const { delta, series } = data;
  return (
    <div className="space-y-10">
      <section aria-label="Net worth over time">
        <p className="mb-3 text-[17px]">
          {delta ? (
            <>
              <span
                aria-hidden="true"
                className={delta.deltaCents < 0 ? "text-spending" : "text-income"}
              >
                {delta.deltaCents < 0 ? "▼" : delta.deltaCents > 0 ? "▲" : "="}
              </span>{" "}
              <Money
                cents={delta.deltaCents}
                sign
                className={`font-bold ${delta.deltaCents < 0 ? "text-spending" : delta.deltaCents > 0 ? "text-income" : ""}`}
              />{" "}
              <span className="text-muted">
                over {data.range === "All" ? "all history" : data.range}
              </span>
            </>
          ) : (
            <span className="text-muted">
              {series.length === 0
                ? "No history yet. The daily snapshot starts once an institution has synced."
                : "One day of history so far, so there is no change to show."}
            </span>
          )}
        </p>
        <NetWorthChart series={series} />
      </section>

      <div className="flex flex-wrap gap-10">
        <AccountList
          title="Assets"
          empty="Checking, savings, brokerage and retirement balances appear here."
          accounts={data.assets}
          owed={false}
        />
        <AccountList
          title="Liabilities"
          empty="Credit cards and loans appear here, with limit usage and due dates."
          accounts={data.liabilities}
          owed
        />
      </div>
    </div>
  );
}

function AccountList({
  title,
  empty,
  accounts,
  owed,
}: {
  title: string;
  empty: string;
  accounts: NetWorthData["assets"];
  owed: boolean;
}) {
  if (accounts.length === 0) {
    return (
      <div className="min-w-0 flex-1 basis-[360px]">
        <EmptyState title={title}>{empty}</EmptyState>
      </div>
    );
  }
  return (
    <section aria-label={title} className="min-w-0 flex-1 basis-[360px] border-t border-rule pt-4">
      <h2 className={`mb-2 ${eyebrow}`}>{title}</h2>
      <ul className="divide-y divide-rule">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-baseline gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px]">{a.name}</div>
              <div className="truncate text-sm text-muted">
                {a.institutionName ?? "Institution"}
                {a.stale && <span className="text-foreground"> · ! needs reconnecting, balance may be old</span>}
              </div>
            </div>
            <div className="text-right text-[17px] font-semibold">
              {owed ? (
                <>
                  <Money cents={a.balanceCents === null ? null : -a.balanceCents} className={a.balanceCents === null ? "" : "text-spending"} />
                  {a.balanceCents !== null && <span className="ml-1 text-sm font-normal text-muted">owed</span>}
                </>
              ) : (
                <Money cents={a.balanceCents} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Investments({ data }: { data: NetWorthData }) {
  if (data.holdings.length === 0) {
    return (
      <EmptyState title="Investments">
        Holdings and allocation appear here once a brokerage is linked.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-10">
      <section aria-label="Allocation" className="border-t border-rule pt-4">
        <h2 className={`mb-4 ${eyebrow}`}>Allocation by type</h2>
        <AllocationRing slices={data.slices} />
      </section>
      <section aria-label="Holdings" className="border-t border-rule pt-4">
        <h2 className={`mb-2 ${eyebrow}`}>Holdings</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[17px]">
            <caption className="sr-only">Holdings, largest first</caption>
            <thead>
              <tr className="border-b border-rule text-[13px] uppercase tracking-[0.14em] text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">Name</th>
                <th scope="col" className="hidden py-2 pr-4 font-semibold sm:table-cell">Account</th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">Share</th>
                <th scope="col" className="py-2 text-right font-semibold">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h, i) => (
                <tr key={`${h.name}-${h.accountName}-${i}`} className="border-b border-rule align-top">
                  <td className="py-3 pr-4">
                    <div>{h.name}</div>
                    <div className="text-sm text-muted">
                      {h.ticker && <>{h.ticker} · </>}
                      <span className="sm:hidden">{h.accountName}</span>
                    </div>
                  </td>
                  <td className="hidden py-3 pr-4 text-muted sm:table-cell">{h.accountName}</td>
                  <td className="whitespace-nowrap py-3 pr-4 text-right">{formatBps(h.shareBps)}</td>
                  <td className="whitespace-nowrap py-3 text-right font-semibold">
                    <Money cents={h.valueCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Debts({ data }: { data: NetWorthData }) {
  if (data.debts.length === 0) {
    return (
      <EmptyState title="Debts">
        Credit cards and loans appear here, with limit usage, due dates and minimum payments.
      </EmptyState>
    );
  }
  return (
    <section aria-label="Debts" className="border-t border-rule pt-4">
      <h2 className={`mb-2 ${eyebrow}`}>Debts</h2>
      <ul className="divide-y divide-rule">
        {data.debts.map((d) => {
          const util = ratioBps(d.balanceCents, d.limitCents);
          const facts = loanFacts(d);
          return (
            <li key={d.id} className="py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold">{d.name}</h3>
                  <p className="text-sm text-muted">
                    {d.institutionName ?? "Institution"}
                    {d.stale && <span className="text-foreground"> · ! needs reconnecting, balance may be old</span>}
                  </p>
                </div>
                <div className="font-display text-4xl font-black text-spending">
                  <Money cents={d.balanceCents === null ? null : -d.balanceCents} />
                  {d.balanceCents !== null && <span className="ml-2 font-sans text-sm font-normal text-muted">owed</span>}
                </div>
              </div>
              {util !== null ? (
                <div className="mt-3">
                  <div aria-hidden="true" className="relative h-4 w-full bg-rule">
                    <div
                      className="h-full bg-spending shadow-[0_0_14px_rgb(255_45_85/0.6)]"
                      style={{ width: `${Math.min(util, 10000) / 100}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[17px] text-muted">
                    {util > 10000 && <span className="font-bold text-spending">! </span>}
                    {formatBps(util)} of {formatCents(d.limitCents)} limit used
                  </p>
                </div>
              ) : facts.length > 0 ? (
                <p className="mt-3 text-[17px] text-muted">{facts.join(" · ")}</p>
              ) : (
                <p className="mt-3 text-[17px] text-muted">No credit limit on file.</p>
              )}
              <p className="mt-2 text-[17px] text-muted">
                {d.nextDueDate ? (
                  <>
                    Due {formatShortDate(d.nextDueDate, true)}
                    {d.minPaymentCents !== null && <> · {paymentLabel(d.kind)} <Money cents={d.minPaymentCents} className="text-foreground" /></>}
                  </>
                ) : (
                  "Due date unknown."
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
