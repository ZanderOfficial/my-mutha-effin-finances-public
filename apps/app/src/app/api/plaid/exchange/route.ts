// Finishes a Plaid Link: stores the new Item, then starts its first sync after responding.
import { after } from "next/server";
import { getInstitutionService } from "@/server/institutions";
import { json, ownerRoute } from "@/server/http/owner-route";
import { parseExchangeBody } from "@/server/institutions/validate";
import { logException } from "@/server/log";
import { getSnapshotRunner } from "@/server/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return ownerRoute(async (ownerId) => {
    const body = parseExchangeBody(await readJson(request));
    if (!body) return json({ error: "Invalid request" }, 400);

    // Exchange the one-time public token and store the Item; the access token never leaves the server.
    const item = await getInstitutionService().completeLink(ownerId, {
      publicToken: body.publicToken,
      institutionName: body.institutionName,
    });

    after(() => firstSync(ownerId));
    return json({ item }, 201);
  });
}

/** The parsed body, or null when it is not JSON. */
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Syncs transactions for every Item and writes today's net worth.
 * Plaid sends SYNC_UPDATES_AVAILABLE only after an Item's first /transactions/sync, so this call starts it.
 */
async function firstSync(ownerId: string): Promise<void> {
  try {
    await getSnapshotRunner().snapshot.run(ownerId);
  } catch (err) {
    // Logged by code only; the daily cron runs the same pass again.
    logException("first_sync_failed", err);
  }
}
