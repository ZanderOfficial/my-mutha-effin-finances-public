// Class strings the Budget tables share; kept out of client modules so server components can read them too.

/** A header cell: sentence case, muted, one line. */
export const TH = "h-10 whitespace-nowrap border-b border-rule bg-background px-2.5 text-left text-[13px] font-semibold text-muted";

/** A body cell at least 44px tall, with a quiet rule under it; add your own padding and wrapping. */
export const CELL = "h-11 border-b border-rule/60 align-middle";

/** The usual body cell: one line, 10px each side. */
export const TD = `${CELL} whitespace-nowrap px-2.5`;

/** A body cell whose input fills it edge to edge, so the whole cell is the target. */
export const TD_EDIT = "relative h-11 border-b border-rule/60 p-0 align-middle";

/** A footer cell: a heavier rule above, no rule below. */
export const FOOT = "h-13 whitespace-nowrap border-t border-rule px-2.5 align-middle";

/** Money and counts: right-aligned with tabular numerals. */
export const NUM = "text-right tabular-nums";

/**
 * The first column stays put while a narrow screen scrolls the rest sideways. Its width is fixed
 * so the scroll box can keep a focused cell out from under it (CLEAR_STICKY matches it).
 */
export const STICKY_FIRST =
  "sticky left-0 z-10 w-40 min-w-40 max-w-40 md:w-44 md:min-w-44 md:max-w-44 bg-background group-hover:bg-panel-raised max-md:shadow-[1px_0_0_var(--color-rule)]";
export const CLEAR_STICKY = "scroll-pl-40 md:scroll-pl-44";

/** A name cell's left gutter, which holds the ▸ of a row with rows under it; every name in the table keeps it, so they line up. */
export const GUTTER = "pl-14";
export const GUTTER_BUTTON = "absolute left-0 top-0";
/** An inbox row's name, and the figures under it on a phone; both wrap there, since the decision column makes the row tall anyway. */
export const INBOX_NAME = "block max-md:whitespace-normal max-md:break-words md:max-w-64 md:truncate";
export const INBOX_SUBLINE = "block whitespace-normal text-[13px] text-muted md:hidden";

/** The gutter ▸ for a row whose first cell is centred text that may stand taller than one line. */
export const GUTTER_BUTTON_MIDDLE = "absolute left-0 top-1/2 -translate-y-1/2";

/** The count of matched charges beside a Spent figure; rows without one keep the space, so the figures line up. */
export const CHARGES_SLOT = "ml-1 w-12";
/** Lines a Spent header or total up with those figures: 4px of cell padding, a 4px gap and the 48px slot. */
export const SPENT_EDGE = "pr-14";

/** A row whose cells brighten on hover, like a database table. */
export const ROW = "group hover:[&>td]:bg-panel-raised hover:[&>th]:bg-panel-raised";

/** Rows nested under another row: matched charges, deposits, a sort's extra fields. */
export const NESTED_ROW = "[&>td]:bg-panel";

/** A small button inside a table: quiet until hovered, still a 44px target. */
export const CELL_BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-3 text-[14px] font-semibold text-muted hover:bg-panel-raised hover:text-foreground focus-visible:-outline-offset-2 disabled:opacity-50";

/** A bordered button inside a table, for the row's one decision. */
export const ROW_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 text-[14px] font-semibold text-foreground hover:border-muted disabled:opacity-50 max-md:px-3";

/** The one filled button in a row, for the choice that does the most ("Make and sort"). */
export const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-foreground bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-50 max-md:px-3";

/** A name that could run long (a bank's description): one line, cut with an ellipsis; give it a title with the whole text. */
export const CLIP = "block max-w-40 truncate md:max-w-64";
export const CLIP_WIDE = "block max-w-md truncate";

/** A tag chip, such as a business in the For column. */
export const TAG = "inline-flex h-6 items-center whitespace-nowrap rounded border border-rule bg-panel-raised px-2 text-[13px] text-foreground";

/** A section heading above a table: plain sentence case, no uppercase eyebrow. */
export const SECTION_HEADING = "text-lg font-semibold";

/** A bordered input or select inside a nested row, where a bare cell input would float. */
export const NESTED_INPUT = "cell-input rounded border border-rule bg-panel-raised";

/** A count badge that needs the owner: the spending red, with a word beside it for screen readers. */
export const ALERT_PILL = "inline-flex h-5 items-center rounded-full bg-spending px-2 text-[12px] font-semibold text-background";
