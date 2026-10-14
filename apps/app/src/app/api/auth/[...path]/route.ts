import { getNeonAuth } from "@/server/auth/neon";

type Ctx = { params: Promise<{ path: string[] }> };
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Neon Auth's browser client talks to this same-origin route. Without auth
 * configuration it answers 503 and nothing else.
 */
function forward(method: Method) {
  return (request: Request, ctx: Ctx): Promise<Response> | Response => {
    const auth = getNeonAuth();
    if (!auth) {
      return Response.json({ error: "Auth is not configured" }, { status: 503 });
    }
    return auth.handler()[method](request, ctx);
  };
}

export const GET = forward("GET");
export const POST = forward("POST");
export const PUT = forward("PUT");
export const DELETE = forward("DELETE");
export const PATCH = forward("PATCH");
