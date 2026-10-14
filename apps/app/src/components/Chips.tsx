import Link from "next/link";

/**
 * A row of link chips driven by the query string, so the page stays server
 * rendered and the state is shareable. The current one is marked with
 * aria-current and a filled look, not colour alone.
 */
export function ChipRow({
  label,
  items,
}: {
  label: string;
  items: { label: string; href: string; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.current ? "true" : undefined}
          scroll={false}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center border-2 px-4 text-[15px] font-bold ${
            item.current
              ? "border-foreground bg-foreground text-background"
              : "border-rule text-muted hover:border-muted hover:text-foreground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

type LinkItem = { label: string; href: string; current: boolean };

/**
 * Database-style view tabs, also driven by the query string: the current one carries a 2px
 * underline in the text colour and aria-current, so it never relies on colour alone.
 */
export function ViewTabs({ label, items, className }: { label: string; items: LinkItem[]; className?: string }) {
  return (
    <nav aria-label={label} className={`flex overflow-x-auto [scrollbar-width:none] ${className ?? ""}`}>
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          scroll={false}
          className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-[15px] font-semibold ${
            item.current ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** A filter of two or three links in one bordered box; the current one is filled in the text colour, so it never relies on a faint tint. */
export function Segmented({ label, items }: { label: string; items: LinkItem[] }) {
  return (
    <nav aria-label={label} className="inline-flex overflow-hidden rounded-md border border-rule">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.current ? "true" : undefined}
          scroll={false}
          className={`inline-flex min-h-11 items-center px-4 text-[14px] font-semibold ${
            item.current ? "bg-foreground text-background" : "text-muted hover:text-foreground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** A plain label above a figure: sentence case, muted. */
export const figureLabel = "text-[15px] font-semibold text-muted";

export const eyebrow = "text-[13px] font-semibold uppercase tracking-[0.14em] text-muted";

export const button = "min-h-11 border-2 border-foreground px-4 text-[15px] font-bold disabled:opacity-50";
