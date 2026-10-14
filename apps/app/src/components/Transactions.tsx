import { categoryLabel } from "@/lib/budget";
import { formatShortDate } from "@/lib/format";
import { Money } from "@/components/Money";
import type { TxRow } from "@/server/reports";

function amountClass(t: TxRow): string {
  if (t.excluded) return "text-muted";
  return t.amountCents > 0 ? "text-income" : t.amountCents < 0 ? "text-spending" : "text-foreground";
}

function Tags({ t }: { t: TxRow }) {
  return (
    <>
      {t.pending && (
        <span className="ml-2 border border-rule px-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">
          pending
        </span>
      )}
      {t.excluded && (
        <span
          className="ml-2 border border-rule px-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted"
          title="A transfer or card payment: listed here, not counted as income or spending"
        >
          transfer
        </span>
      )}
    </>
  );
}

/** Signed amount: income gets +, spending gets the true minus. Colour is never the only cue. */
function Amount({ t }: { t: TxRow }) {
  return <Money cents={t.amountCents} sign className={`font-semibold ${amountClass(t)}`} />;
}

/** The 5-row list on the Overview. */
export function LatestList({ rows }: { rows: TxRow[] }) {
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {rows.map((t) => (
        <li key={t.id} className="flex items-baseline gap-4 py-3">
          <span className="w-14 shrink-0 text-sm text-muted">{formatShortDate(t.date)}</span>
          <span className="min-w-0 flex-1 truncate text-[17px]">
            {t.merchant ?? t.name}
            <Tags t={t} />
          </span>
          <Amount t={t} />
        </li>
      ))}
    </ul>
  );
}

/** The full table on the Transactions screen. */
export function TransactionsTable({ rows }: { rows: TxRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[17px]">
        <caption className="sr-only">Transactions, newest first</caption>
        <thead>
          <tr className="border-b border-rule text-[13px] uppercase tracking-[0.14em] text-muted">
            <th scope="col" className="py-2 pr-4 font-semibold">Date</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Merchant</th>
            <th scope="col" className="hidden py-2 pr-4 font-semibold md:table-cell">Category</th>
            <th scope="col" className="hidden py-2 pr-4 font-semibold md:table-cell">Account</th>
            <th scope="col" className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-rule align-top">
              <td className="whitespace-nowrap py-3 pr-4 text-muted">
                {formatShortDate(t.date, true)}
              </td>
              <td className="py-3 pr-4">
                <div className="min-w-0 break-words">
                  {t.merchant ?? t.name}
                  <Tags t={t} />
                </div>
                <div className="text-sm text-muted md:hidden">
                  {categoryLabel(t.category ?? "UNCATEGORIZED")} · {t.accountName}
                </div>
              </td>
              <td className="hidden py-3 pr-4 text-muted md:table-cell">
                {categoryLabel(t.category ?? "UNCATEGORIZED")}
              </td>
              <td className="hidden py-3 pr-4 text-muted md:table-cell">{t.accountName}</td>
              <td className="whitespace-nowrap py-3 text-right">
                <Amount t={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
