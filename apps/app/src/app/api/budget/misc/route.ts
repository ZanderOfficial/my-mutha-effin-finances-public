// Budget tab badge source: how many transactions wait in Misc. null means unknown.
import { json, ownerRoute } from "@/server/http/owner-route";
import { loadMiscCount } from "@/server/reports";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return ownerRoute(async () => json({ misc: await loadMiscCount() }));
}
