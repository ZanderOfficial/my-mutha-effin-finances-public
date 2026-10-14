const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-06-12" as "Jun 12" (or "Jun 12, 2026"). Pure text maths, no time zones. */
export function formatShortDate(date: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return date;
  const day = Number(m[3]);
  return withYear ? `${month} ${day}, ${m[1]}` : `${month} ${day}`;
}

/** "2026-03" as "Mar" (or "March"). Unrecognised text is returned as it is. */
export function formatMonth(month: string, long = false): string {
  const m = /^\d{4}-(\d{2})$/.exec(month);
  const index = m ? Number(m[1]) - 1 : -1;
  const names = long ? LONG_MONTHS : MONTHS;
  return names[index] ?? month;
}

/** "1 day", "17 days". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
