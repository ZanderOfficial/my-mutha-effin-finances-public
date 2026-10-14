import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dateInTimezone, ownerTimezone, TimezoneConfigError } from "./timezone";

describe("owner timezone", () => {
  it("defaults to UTC and validates with Intl", () => {
    expect(ownerTimezone({})).toBe("UTC");
    expect(ownerTimezone({ OWNER_TIMEZONE: "America/Chicago" })).toBe("America/Chicago");
    expect(() => ownerTimezone({ OWNER_TIMEZONE: "Not/AZone" })).toThrow(TimezoneConfigError);
  });
  it("dates a moment in the owner's zone, not UTC", () => {
    const moment = new Date("2026-03-10T03:30:00Z");
    expect(dateInTimezone("UTC", moment)).toBe("2026-03-10");
    expect(dateInTimezone("America/Los_Angeles", moment)).toBe("2026-03-09");
    expect(dateInTimezone("Asia/Tokyo", moment)).toBe("2026-03-10");
  });
});

describe("vercel.json", () => {
  it("has exactly one snapshot cron that runs at most once a day (Hobby)", () => {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(cfg.crons).toHaveLength(1);
    expect(cfg.crons[0].path).toBe("/api/cron/snapshot");
    const [min, hour, dom, mon, dow] = cfg.crons[0].schedule.split(" ");
    expect(/^\d+$/.test(min) && /^\d+$/.test(hour)).toBe(true);
    expect([dom, mon, dow]).toEqual(["*", "*", "*"]);
  });
});
