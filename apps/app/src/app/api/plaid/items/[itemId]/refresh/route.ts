import { getInstitutionService } from "@/server/institutions";
import { json, ownerRoute } from "@/server/http/owner-route";
import { isEmptyBody } from "@/server/institutions/validate";

export const dynamic = "force-dynamic";

/**
 * Re-reads an Item's status and cached balances. The browser calls this after
 * an update-mode Link succeeds, which is what clears needs_reauth.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  return ownerRoute(async (ownerId) => {
    if (!isEmptyBody(await request.text())) return json({ error: "Invalid request" }, 400);
    const { itemId } = await ctx.params;
    const { status } = await getInstitutionService().refreshItem(ownerId, itemId);
    return json({ status });
  });
}
