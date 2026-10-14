import { DatabaseNotConfiguredError } from "@/server/db";
import { PlaidConfigError } from "@/server/plaid/errors";
import { handleSnapshotCron } from "@/server/sync/cron";
import { getSnapshotRunner } from "@/server/sync";
import { logException } from "@/server/log";
import { TimezoneConfigError } from "@/server/sync/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron calls this once a day with `Authorization: Bearer $CRON_SECRET`.
 * The proxy leaves /api/cron open because the secret is the credential; the
 * handler rejects everything else before touching the database.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return await handleSnapshotCron(request, {
      secret: process.env.CRON_SECRET,
      ownerIds: () => getSnapshotRunner().repo.itemOwnerIds(),
      runSnapshot: (ownerId) => getSnapshotRunner().snapshot.run(ownerId),
    });
  } catch (err) {
    if (
      err instanceof PlaidConfigError ||
      err instanceof DatabaseNotConfiguredError ||
      err instanceof TimezoneConfigError
    ) {
      logException("cron_not_configured", err, { status: 503 });
      return Response.json({ error: "Service is not configured" }, { status: 503 });
    }
    logException("cron_failed", err, { status: 500 });
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
