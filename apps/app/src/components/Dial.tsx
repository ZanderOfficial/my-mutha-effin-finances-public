import { RING_CIRCUMFERENCE, dialFontSize, dialGeometry } from "@/lib/dial";
import { CountSvgText } from "@/components/CountUp";
import { gapCents } from "@/lib/flow";
import { formatCents } from "@/lib/money";

type Props = {
  incomeCents: number | null;
  spendingCents: number | null;
  /** What the inner ring stands for, in the label: spending, or everything the month takes. */
  outWords?: string;
  className?: string;
};

/**
 * Income is the full outer ring; spending fills the inner ring and runs past
 * full when overspent. The centre carries one figure and no words: the gap,
 * income minus spending, signed (red and minus when overspent). With no data it
 * draws empty outlines and no text.
 */
export function Dial({ incomeCents, spendingCents, outWords = "spending", className }: Props) {
  const geometry = dialGeometry(incomeCents, spendingCents);
  const gap = gapCents(incomeCents, spendingCents);
  const centre = gap === null ? null : formatCents(gap, { sign: true });
  const label =
    gap === null
      ? "No income or spending data yet."
      : `Income ${formatCents(incomeCents)}, ${outWords} ${formatCents(spendingCents)}, ${
          gap < 0 ? "short by" : "kept"
        } ${formatCents(Math.abs(gap))}.`;

  return (
    <svg
      viewBox="0 0 400 400"
      role="img"
      aria-label={label}
      className={className ?? "mx-auto block w-full max-w-[400px]"}
    >
      <title>{label}</title>
      <defs>
        <filter id="dial-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="200" cy="200" r="190" fill="#0a0a0b" />
      <circle
        cx="200"
        cy="200"
        r="170"
        fill="none"
        stroke={incomeCents !== null && incomeCents > 0 ? "#39ff88" : "#2a2a2e"}
        strokeWidth="12"
        filter={incomeCents !== null && incomeCents > 0 ? "url(#dial-glow)" : undefined}
      />
      <circle cx="200" cy="200" r="138" fill="none" stroke="#2a2a2e" strokeWidth="22" />
      {geometry && geometry.filled > 0 && (
        <circle
          className="ring-draw"
          cx="200"
          cy="200"
          r="138"
          fill="none"
          stroke="#ff2d55"
          strokeWidth="22"
          strokeDasharray={`${geometry.filled} ${RING_CIRCUMFERENCE}`}
          transform="rotate(-90 200 200)"
          filter="url(#dial-glow)"
        />
      )}
      {geometry && geometry.overflow > 0 && (
        <circle
          className="ring-draw"
          cx="200"
          cy="200"
          r="138"
          fill="none"
          stroke="#ffd0d9"
          strokeWidth="22"
          strokeDasharray={`${geometry.overflow} ${RING_CIRCUMFERENCE}`}
          transform="rotate(-90 200 200)"
        />
      )}
      {centre !== null && gap !== null && (
        <CountSvgText
          id="dial"
          cents={gap}
          x="200"
          y="200"
          dy="0.35em"
          textAnchor="middle"
          fill={gap < 0 ? "#ff2d55" : "#39ff88"}
          fontFamily="var(--font-big-shoulders)"
          fontSize={dialFontSize(centre)}
          fontWeight="900"
        />
      )}
    </svg>
  );
}
