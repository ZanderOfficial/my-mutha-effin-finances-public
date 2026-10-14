import { monthWindow, type MonthWindow } from "@/lib/month";
import { dateInTimezone } from "@/server/sync/timezone";

/**
 * "This month" for the owner: the calendar month containing `now` in `timeZone`
 * (OWNER_TIMEZONE). At 02:00 UTC on 1 March an owner in Los Angeles is still
 * on 28 February, so their month has not rolled over yet.
 */
export function monthWindowAt(now: Date, timeZone: string): MonthWindow {
  return monthWindow(dateInTimezone(timeZone, now));
}
