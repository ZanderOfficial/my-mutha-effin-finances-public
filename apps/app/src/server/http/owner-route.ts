import { getOwnerId } from "@/server/auth";
import { InstitutionServiceError } from "@/server/institutions/service";
import { PlaidConfigError } from "@/server/plaid/errors";
import { DatabaseNotConfiguredError } from "@/server/db";
import { logException } from "@/server/log";

const HEADERS = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: HEADERS });
}

/**
 * Wraps an owner-only JSON route. It resolves the owner first and fails
 * closed: no owner (auth unconfigured, signed out, or not the owner) is a 401
 * and `fn` never runs. Errors become small, safe JSON; nothing from Plaid's
 * response bodies or from exceptions' messages is forwarded beyond our own
 * safe text. (API routes answer 401 rather than redirect, so a browser fetch
 * gets a status it can act on; requireOwner() is for pages.)
 */
export async function ownerRoute(
  fn: (ownerId: string) => Promise<Response>,
): Promise<Response> {
  const ownerId = await getOwnerId();
  if (!ownerId) return json({ error: "Unauthorized" }, 401);
  try {
    return await fn(ownerId);
  } catch (err) {
    if (err instanceof PlaidConfigError || err instanceof DatabaseNotConfiguredError) {
      logException("route_not_configured", err, { status: 503 });
      return json({ error: "Service is not configured" }, 503);
    }
    if (err instanceof InstitutionServiceError) {
      logException("route_institution_error", err, { code: err.plaid?.code });
      if (err.kind === "cap_reached") return json({ error: err.message, code: "CAP_REACHED" }, 409);
      if (err.kind === "not_found") return json({ error: err.message, code: "NOT_FOUND" }, 404);
      return json(
        { error: err.message, code: err.plaid?.code ?? "PLAID_ERROR" },
        err.plaid?.isLoginRequired ? 409 : 502,
      );
    }
    logException("route_failed", err, { status: 500 });
    return json({ error: "Something went wrong" }, 500);
  }
}
