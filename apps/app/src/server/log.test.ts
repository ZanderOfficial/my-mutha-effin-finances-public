import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, itemRef, logException, logInfo, sanitize } from "./log";

const SRC = fileURLToPath(new URL("..", import.meta.url));

/**
 * Files that may mention `console.`: the logger itself and this test. There is
 * no client-side allowlist entry; client components must not log either, since
 * browser consoles and error reporters see what they print.
 */
const ALLOWED = new Set(["server/log.ts", "server/log.test.ts"].map((p) => p.split("/").join(sep)));

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) yield full;
  }
}

describe("no raw console usage", () => {
  it("only src/server/log.ts calls console", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      if (/\bconsole\s*[.[]/.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("logger allowlist", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the safe fields and nothing else", () => {
    const fields = {
      status: 502,
      code: "ITEM_LOGIN_REQUIRED",
      errorName: "PlaidApiError",
      itemRef: itemRef("synthetic-item-id"),
      // Not in the type; a careless caller could still pass these.
      message: "balance 1234.56",
      accessToken: "access-sandbox-0000",
      body: { x: 1 },
    } as never;
    const out = sanitize("sync_failed", fields);
    expect(Object.keys(out).sort()).toEqual(["code", "errorName", "event", "itemRef", "status"]);
    expect(JSON.stringify(out)).not.toMatch(/balance|access-|body/);
  });

  it("drops a value that does not look like its field", () => {
    const out = sanitize("sync_failed", {
      status: 9000,
      code: "access-sandbox-abc",
      errorName: "has spaces and 1234.56",
      itemRef: "not-hex",
    });
    expect(out).toEqual({ event: "sync_failed" });
  });

  it("rejects an event name that is free text", () => {
    expect(sanitize("failed for account ****1234").event).toBe("invalid_event_name");
  });

  it("hashes an item id to 12 hex characters that do not contain it", () => {
    const ref = itemRef("synthetic-item-id");
    expect(ref).toMatch(/^[0-9a-f]{12}$/);
    expect(ref).toBe(itemRef("synthetic-item-id"));
    expect(ref).not.toBe(itemRef("another-item-id"));
  });

  it("describes an exception by name and code, never its message", () => {
    const err = Object.assign(new Error("postgres://user:secret@host/db failed"), {
      code: "ECONNRESET",
    });
    expect(describeError(err)).toEqual({ errorName: "Error", code: "ECONNRESET" });
    expect(describeError("a string with a token")).toEqual({});
  });

  it("writes one JSON line and leaks no message", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logException("route_failed", new Error("DATABASE_URL=postgres://u:p@h/d"), { status: 500 });
    logInfo("cron_done", { status: 200 });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe('{"event":"route_failed","status":500,"errorName":"Error"}');
    expect(String(error.mock.calls[0][0])).not.toContain("postgres");
    expect(info.mock.calls[0][0]).toBe('{"event":"cron_done","status":200}');
  });
});
