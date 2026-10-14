// Reads the signed-in owner per request; must never be prerendered.
export const dynamic = "force-dynamic";

import Link from "next/link";
import { Sparkline } from "@/components/Charts";
import { eyebrow } from "@/components/Chips";
import { Dial } from "@/components/Dial";
import { EmptyState } from "@/components/EmptyState";
import { CountMoney } from "@/components/CountUp";
import { Money } from "@/components/Money";
import { LatestList } from "@/components/Transactions";
import { dryLine, gapState, spendingDelta } from "@/lib/flow";
import { needWords, standingSentence } from "@/lib/month-standing";
import { formatShortDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { loadOverview } from "@/server/reports";

const PILL: Record<"over" | "ahead" | "even", { glyph: string; border: string; glow: string }> = {
  over: {
    glyph: "!",
    border: "border-spending",
    glow: "shadow-[0_0_24px_rgb(255_45_85/0.55)]",
  },
  ahead: {
    glyph: "✓",
    border: "border-income",
    glow: "shadow-[0_0_24px_rgb(57_255_136/0.5)]",
  },
  even: { glyph: "=", border: "border-foreground", glow: "" },
};

export default async function OverviewPage() {
  const o = await loadOverview();
  const w = o.window;
  const { flow } = o;
  // The headline: income against everything the Ledger needs this month, less extras (the owner, 2026-10-10).
  const { standing } = o;
  const headline = standing.standingCents;
  const sentence = w ? standingSentence(headline, w.daysLeft) : null;
  const dry = w ? dryLine(headline, w.dayOfMonth) : null;
  const pill = headline === null ? null : PILL[gapState(headline)];
  const need = needWords(standing);
  const takes = standing.needCents === null || standing.extrasCents === null ? null : standing.needCents + standing.extrasCents;
  const delta = spendingDelta(flow.spendingCents, flow.prevSpendingCents);

  return (
    <main id="main" className="flex-1">
      <h1 className="sr-only">Overview</h1>
      <section
        aria-label="Income versus spending this month"
        className="relative grid md:grid-cols-2 md:bg-[linear-gradient(90deg,rgb(57_255_136/0.12)_50%,rgb(255_45_85/0.13)_50%)]"
      >
        <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px bg-rule md:block" />

        <div className="order-1 min-w-0 bg-[rgb(57_255_136/0.12)] px-6 pb-36 pt-9 sm:px-10 md:order-none md:col-start-1 md:row-start-1 md:bg-transparent md:pb-6">
          <div className={eyebrow}>In · income</div>
          <div
            className={`hero-numeral hero-in ${flow.incomeCents === null ? "text-muted" : "glow-income"}`}
          >
            <CountMoney id="income" cents={flow.incomeCents} sign compact />
          </div>
        </div>

        <div className="order-3 min-w-0 bg-[rgb(255_45_85/0.13)] px-6 pb-12 pt-40 sm:px-10 md:order-none md:col-start-2 md:row-start-1 md:bg-transparent md:pb-6 md:pt-9 md:text-right">
          <div className={eyebrow}>Out · spending</div>
          <div
            className={`hero-numeral hero-in ${flow.spendingCents === null ? "text-muted" : "glow-spending"}`}
          >
            <CountMoney
              id="spending"
              cents={flow.spendingCents === null ? null : -flow.spendingCents}
              compact
            />
          </div>
          {delta && (
            <p className="mt-3 text-base text-muted">
              {delta.direction === "same" ? (
                <>= Same as this day last month</>
              ) : (
                <>
                  <span
                    className={delta.direction === "more" ? "text-spending" : "text-income"}
                    aria-hidden="true"
                  >
                    {delta.direction === "more" ? "▲" : "▼"}
                  </span>{" "}
                  {formatCents(delta.diffCents, { trimZeroCents: true })}{" "}
                  {delta.direction === "more" ? "more" : "less"} than this day last month
                </>
              )}
            </p>
          )}
          {flow.pendingCount > 0 && (
            <p className="mt-1 text-sm text-muted">
              Includes {flow.pendingCount} pending {flow.pendingCount === 1 ? "item" : "items"}.
            </p>
          )}
          {flow.unsortedCount > 0 && (
            <p className="mt-1 text-sm text-muted">
              <Link href="/budget?view=income#unsorted" className="font-semibold text-foreground underline underline-offset-4">
                {flow.unsortedCount} {flow.unsortedCount === 1 ? "deposit" : "deposits"} to sort
              </Link>
              , so income may be low.
            </p>
          )}
        </div>

        <div className="relative z-10 order-2 -my-28 flex flex-col items-center bg-[linear-gradient(180deg,rgb(57_255_136/0.12)_50%,rgb(255_45_85/0.13)_50%)] md:bg-none md:order-none md:col-span-2 md:row-start-2 md:my-0 md:pb-12">
          <Dial
            incomeCents={flow.incomeCents}
            spendingCents={takes}
            outWords="what the month takes"
            className="block h-56 w-56 sm:h-64 sm:w-64"
          />
          <p
            className={`-mt-5 inline-flex min-h-11 max-w-[calc(100%-3rem)] items-center gap-2 rounded-full border-2 bg-background px-5 py-2 text-center text-[17px] font-semibold ${
              pill ? `${pill.border} ${pill.glow}` : "border-rule text-muted"
            }`}
          >
            {pill && (
              <span aria-hidden="true" className="font-black">
                {pill.glyph}
              </span>
            )}
            {sentence ?? (standing.needCents === null && flow.dataKnown ? "Add your costs to the Ledger." : "Nothing here yet.")}
          </p>
          {need && (
            <p className="mt-3 max-w-xl px-6 text-center text-base text-muted">
              Income minus what the month needs ({need}), minus{" "}
              <Money cents={standing.extrasCents} className="text-foreground" /> spent outside the plan.{" "}
              <Link href="/budget?view=ledger" className="font-semibold text-foreground underline underline-offset-4">
                Ledger
              </Link>
            </p>
          )}
          {dry && <p className="mt-2 text-base text-muted">{dry}</p>}
        </div>
      </section>

      <div className="flex flex-wrap gap-10 px-6 py-12 sm:px-10">
        <section aria-label="Net worth" className="min-w-0 flex-1 basis-[300px] border-t border-rule pt-4">
          <h2 className={`mb-2 ${eyebrow}`}>Net worth</h2>
          <div className="font-display text-6xl font-bold leading-none">
            <Money cents={o.netWorth?.netWorthCents ?? null} compact />
          </div>
          <p className="mt-3 text-sm text-muted">
            Assets <Money cents={o.netWorth?.assetsCents ?? null} /> · Liabilities{" "}
            <Money cents={o.netWorth ? -o.netWorth.liabilitiesCents : null} />
          </p>
          {o.netWorth && (
            <p className="mt-1 text-sm text-muted">
              As of {formatShortDate(o.netWorth.date, true)}
              {o.netWorth.incomplete && (
                <>
                  . <span className="text-foreground">! Some balances are unknown, so this may read low.</span>
                </>
              )}
            </p>
          )}
          <Sparkline series={o.series} />
          <Link href="/net-worth" className="mt-3 inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-4">
            See net worth
          </Link>
        </section>

        <section aria-label="Latest transactions" className="min-w-0 flex-[2] basis-[460px] border-t border-rule pt-4">
          <h2 className={`mb-2 ${eyebrow}`}>Latest</h2>
          {o.latest.length === 0 ? (
            <p className="max-w-xl text-[17px] text-muted">
              Nothing here yet. Your newest transactions show up once an institution has synced.
            </p>
          ) : (
            <>
              <LatestList rows={o.latest} />
              <Link href="/transactions" className="mt-3 inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-4">
                All transactions
              </Link>
            </>
          )}
        </section>

        <div className="min-w-0 flex-1 basis-[280px]">
          {o.attention.length > 0 ? (
            <section className="border-t border-rule pt-4">
              <h2 className={`mb-2 ${eyebrow}`}>Needs you</h2>
              <ul className="space-y-3">
                {o.attention.map((i) => (
                  <li key={i.id} className="text-[17px]">
                    <span className="font-bold text-spending">! </span>
                    {i.institutionName ?? "An institution"}{" "}
                    {i.status === "revoked" ? "was disconnected" : "needs you to reconnect"}.
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-base text-muted">Locked out. Fix it before the numbers lie.</p>
              <Link
                href="/institutions"
                className="mt-4 inline-flex min-h-11 items-center border-2 border-spending px-6 text-base font-bold glow-spending-sm"
              >
                Open My Institutions
              </Link>
            </section>
          ) : o.linkedCount !== null && o.linkedCount > 0 ? (
            <section className="border-t border-rule pt-4">
              <h2 className={`mb-2 ${eyebrow}`}>Needs you</h2>
              <p className="max-w-xl text-[17px] text-muted">
                <span className="font-bold text-income">✓ </span>
                Nothing. All {o.linkedCount} linked {o.linkedCount === 1 ? "institution is" : "institutions are"} connected.
              </p>
            </section>
          ) : (
            <EmptyState
              title="Needs you"
              action={{ href: "/institutions", label: "+ Link an institution" }}
            >
              No institutions are linked, so there is nothing to track yet.
            </EmptyState>
          )}
        </div>
      </div>
    </main>
  );
}
