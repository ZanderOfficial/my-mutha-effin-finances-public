import { formatCents, formatCentsCompact } from "@/lib/money";

type Props = {
  cents: number | null | undefined;
  sign?: boolean;
  /** Hero-size figures go compact above seven figures; the full value stays in the tooltip. */
  compact?: boolean;
  className?: string;
};

/**
 * A money figure. Unknown (null) is an em dash, a real zero is $0.00. When the
 * compact form differs from the full one, the full value is in the tooltip and
 * is what a screen reader hears.
 */
export function Money({ cents, sign, compact, className }: Props) {
  const full = formatCents(cents, { sign });
  const shown = compact ? formatCentsCompact(cents, { sign }) : full;
  if (shown === full) return <span className={className}>{full}</span>;
  return (
    <span className={className} title={full}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
