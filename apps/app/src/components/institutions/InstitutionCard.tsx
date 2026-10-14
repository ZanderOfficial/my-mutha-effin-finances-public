import type { AccountView, InstitutionView } from "@/server/institutions/reads";
import { formatCents } from "@/lib/money";
import { ReconnectButton, UnlinkButton } from "./LinkActions";

function accountBalance(a: AccountView): string {
  if (a.balanceCents === null) return formatCents(null);
  // Plaid reports credit and loan balances as the positive amount owed. Show
  // them with a minus sign and the word "owed" so debt is never read as cash.
  return a.isLiability
    ? `${formatCents(-a.balanceCents)} owed`
    : formatCents(a.balanceCents);
}

export function InstitutionCard({ institution }: { institution: InstitutionView }) {
  const name = institution.institutionName ?? "Unnamed institution";
  const needsReauth = institution.status === "needs_reauth";

  return (
    <article
      aria-label={name}
      className="border border-rule bg-panel p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-black">{name}</h2>
          {needsReauth ? (
            <p className="mt-1 text-base font-semibold text-spending">
              <span aria-hidden="true">! </span>Needs reconnect
            </p>
          ) : (
            <p className="mt-1 text-base font-semibold text-income">
              <span aria-hidden="true">✓ </span>Synced
            </p>
          )}
        </div>
        {needsReauth && <ReconnectButton itemId={institution.id} />}
      </header>

      {needsReauth && (
        <p className="mt-3 text-sm text-muted">
          Locked out. Fix it before the numbers lie. Balances below are the last
          ones Plaid gave us.
        </p>
      )}

      {institution.accounts.length === 0 ? (
        <p className="mt-4 text-base text-muted">No accounts yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-t border-rule">
          {institution.accounts.map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-4 py-3">
              <span className="min-w-0">
                <span className="block truncate text-base">{a.name}</span>
                <span className="block text-sm text-muted">
                  {a.subtype ?? a.type}
                  {a.mask ? ` ····${a.mask}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-lg font-semibold">{accountBalance(a)}</span>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-3 flex justify-end">
        <UnlinkButton itemId={institution.id} name={name} />
      </footer>
    </article>
  );
}
