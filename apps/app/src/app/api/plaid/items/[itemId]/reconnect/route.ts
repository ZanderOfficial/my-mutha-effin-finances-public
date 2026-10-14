import { getInstitutionService } from "@/server/institutions";
import { json, ownerRoute } from "@/server/http/owner-route";
import { isEmptyBody } from "@/server/institutions/validate";

export const dynamic = "force-dynamic";

/** Update-mode Link token for one of the owner's Items. */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  return ownerRoute(async (ownerId) => {
    if (!isEmptyBody(await request.text())) return json({ error: "Invalid request" }, 400);
    const { itemId } = await ctx.params;
    const { linkToken } = await getInstitutionService().startReconnect(ownerId, itemId);
    return json({ link_token: linkToken });
  });
}
