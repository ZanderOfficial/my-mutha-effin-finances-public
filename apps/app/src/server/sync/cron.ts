import { createHash, timingSafeEqual } from "node:crypto";
import { logException } from "@/server/log";
import type { SnapshotResult } from "./snapshot";

/** Constant-time check of `Authorization: Bearer <secret>`. Fails closed on an unset secret. */
export function isAuthorisedCron(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret || secret.trim() === "" || !authHeader) return false;
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(authHeader), digest(`Bearer ${secret}`));
}

export type CronDeps = {
  secret: string | undefined;
  ownerIds: () => Promise<string[]>;
  runSnapshot: (ownerId: string) => Promise<SnapshotResult>;
};

const reply = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The daily snapshot job. Unauthenticated callers get 401 before anything
 * else happens. One owner failing never stops the others; the response
 * carries counts only, never account or money values.
 */
export async function handleSnapshotCron(request: Request, deps: CronDeps): Promise<Response> {
  if (!isAuthorisedCron(request.headers.get("authorization"), deps.secret)) {
    return reply(401, { error: "Unauthorized" });
  }
  const owners = await deps.ownerIds();
  let succeeded = 0;
  let failed = 0;
  let netWorthRows = 0;
  for (const ownerId of owners) {
    try {
      const r = await deps.runSnapshot(ownerId);
      succeeded += 1;
      if (r.netWorthWritten) netWorthRows += 1;
    } catch (err) {
      logException("cron_snapshot_owner_failed", err);
      failed += 1;
    }
  }
  return reply(failed > 0 ? 500 : 200, { owners: owners.length, succeeded, failed, netWorthRows });
}
