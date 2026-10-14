export class TimezoneConfigError extends Error {
  constructor() {
    super("OWNER_TIMEZONE is not a valid IANA time zone");
    this.name = "TimezoneConfigError";
  }
}

/** OWNER_TIMEZONE, default UTC. Throws TimezoneConfigError when it is not a real zone. */
export function ownerTimezone(env: Record<string, string | undefined> = process.env): string {
  const raw = env.OWNER_TIMEZONE?.trim();
  const tz = raw ? raw : "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new TimezoneConfigError();
  }
  return tz;
}

/** The calendar date (YYYY-MM-DD) at `now` in `timeZone`. */
export function dateInTimezone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
