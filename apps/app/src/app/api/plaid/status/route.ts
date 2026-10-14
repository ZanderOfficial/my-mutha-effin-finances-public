import { isDatabaseConfigured } from "@/server/db";
import { json, ownerRoute } from "@/server/http/owner-route";
import { institutionReads } from "@/server/institutions/reads";

export const dynamic = "force-dynamic";

/** Header badge source: how many Items need reconnecting. null means unknown. */
export async function GET(): Promise<Response> {
  return ownerRoute(async (ownerId) => {
    if (!isDatabaseConfigured()) return json({ needs_reauth: null });
    return json({ needs_reauth: await institutionReads.countNeedsReauth(ownerId) });
  });
}
