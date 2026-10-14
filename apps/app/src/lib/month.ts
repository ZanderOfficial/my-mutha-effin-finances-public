/**
 * Calendar maths for "this month" in the owner's time zone. Everything here is
 * pure and works on YYYY-MM-DD strings; the caller turns an instant into the
 * owner's local date first (see `server/reports/window.ts`), so a transaction
 * on the 31st never lands in the wrong month because the server runs in UTC.
 */

export type MonthWindow = {
  /** The owner's local date, YYYY-MM-DD. */
  today: string;
  /** First day of the month, inclusive. */
  start: string;
  /** First day of the next month, exclusive. */
  endExclusive: string;
  /** First day of the previous month. */
  prevStart: string;
  /**
   * End (exclusive) of "the same day last month": the previous month up to and
   * including today's day number, capped at the previous month's length.
   */
  prevSameDayEndExclusive: string;
  daysInMonth: number;
  /** Days elapsed including today (the 13th is 13). */
  dayOfMonth: number;
  /** Days after today left in the month (the 13th of 30 leaves 17). */
  daysLeft: number;
  /** Month progress in basis points, dayOfMonth / daysInMonth, rounded down. */
  progressBps: number;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(date: string): { y: number; m: number; d: number } {
  const match = DATE.exec(date);
  if (!match) throw new RangeError("Expected a YYYY-MM-DD date");
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new RangeError("Not a real calendar date");
  }
  return { y, m, d };
}

export function formatDate(y: number, m: number, d: number): string {
  // Date.UTC normalises overflow (month 13, day 0), which is what we want.
  const t = new Date(Date.UTC(y, m - 1, d));
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(t.getUTCFullYear(), 4)}-${p(t.getUTCMonth() + 1, 2)}-${p(t.getUTCDate(), 2)}`;
}

export function daysInMonthOf(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthWindow(today: string): MonthWindow {
  const { y, m, d } = parseDate(today);
  const daysInMonth = daysInMonthOf(y, m);
  const prev = formatDate(y, m - 1, 1);
  const prevParts = parseDate(prev);
  const prevDays = daysInMonthOf(prevParts.y, prevParts.m);
  const sameDay = Math.min(d, prevDays);
  return {
    today,
    start: formatDate(y, m, 1),
    endExclusive: formatDate(y, m + 1, 1),
    prevStart: prev,
    prevSameDayEndExclusive: formatDate(prevParts.y, prevParts.m, sameDay + 1),
    daysInMonth,
    dayOfMonth: d,
    daysLeft: daysInMonth - d,
    progressBps: Math.floor((d * 10000) / daysInMonth),
  };
}

/** `date` moved by whole months; the day is clamped (31 Mar minus 1 month is 28 Feb). */
export function addMonthsClamped(date: string, months: number): string {
  const { y, m, d } = parseDate(date);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  return formatDate(ty, tm, Math.min(d, daysInMonthOf(ty, tm)));
}
