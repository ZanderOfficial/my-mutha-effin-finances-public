import Link from "next/link";

type Props = {
  title: string;
  /** Plain words about what appears here once data has synced. */
  children: React.ReactNode;
  action?: { href: string; label: string };
};

/** Blank screen content: no figures, just what this screen will show. */
export function EmptyState({ title, children, action }: Props) {
  return (
    <section className="border-t border-rule pt-4">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h2>
      <p className="max-w-xl text-[17px] text-muted">{children}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-flex min-h-11 items-center border-2 border-income px-6 text-base font-bold glow-income-sm"
        >
          {action.label}
        </Link>
      )}
    </section>
  );
}
