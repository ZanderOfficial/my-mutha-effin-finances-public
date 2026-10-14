import { getInstitutionService } from "@/server/institutions";
import { json, ownerRoute } from "@/server/http/owner-route";

export const dynamic = "force-dynamic";

/** Unlinks one of the owner's Items: removes it at Plaid, then deletes our rows. */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  return ownerRoute(async (ownerId) => {
    const { itemId } = await ctx.params;
    await getInstitutionService().unlink(ownerId, itemId);
    return json({ ok: true });
  });
}
