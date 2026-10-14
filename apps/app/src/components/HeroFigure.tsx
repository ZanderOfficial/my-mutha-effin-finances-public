// The smaller figures beside a Budget tab's hero numeral: a plain label over a display-font value.
import type { ReactNode } from "react";
import { figureLabel } from "./Chips";

export function HeroFigure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className={figureLabel}>{label}</div>
      <div className="font-display text-[40px] font-bold leading-tight">{children}</div>
    </div>
  );
}
