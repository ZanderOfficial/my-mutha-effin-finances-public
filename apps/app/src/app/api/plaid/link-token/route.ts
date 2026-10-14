import { getInstitutionService } from "@/server/institutions";
import { json, ownerRoute } from "@/server/http/owner-route";
import { isEmptyBody } from "@/server/institutions/validate";

export const dynamic = "force-dynamic";

/** Creates a Link token for a NEW institution. Returns only the short-lived link token. */
export async function POST(request: Request): Promise<Response> {
  return ownerRoute(async (ownerId) => {
    if (!isEmptyBody(await request.text())) return json({ error: "Invalid request" }, 400);
    const { linkToken } = await getInstitutionService().startLink(ownerId);
    return json({ link_token: linkToken });
  });
}
