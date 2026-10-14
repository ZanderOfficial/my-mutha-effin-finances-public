import { json, ownerRoute } from "@/server/http/owner-route";
import { isEmptyBody } from "@/server/institutions/validate";
import { getSyncService } from "@/server/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Owner-only manual sync of one Item (balances, transactions, liabilities, holdings). */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  return ownerRoute(async (ownerId) => {
    if (!isEmptyBody(await request.text())) return json({ error: "Invalid request" }, 400);
    const { itemId } = await ctx.params;
    const r = await getSyncService().syncItem(ownerId, itemId);
    const ok = (s: { ok: boolean }) => s.ok;
    return json({
      balances: ok(r.balances),
      transactions: ok(r.transactions),
      liabilities: ok(r.liabilities),
      holdings: ok(r.holdings),
    });
  });
}
