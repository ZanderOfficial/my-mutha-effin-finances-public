// Gives every page a fresh CSP nonce and sends signed-out visitors to sign-in.
// The sign-in redirect is a convenience, not the security boundary: every data access calls requireOwner().
import { NextRequest, NextResponse } from "next/server";
import { getNeonAuth } from "@/server/auth/neon";
import { NONCE_HEADER, contentSecurityPolicy, createNonce } from "../security-headers";

const SIGN_IN = "/auth/sign-in";

/** Pages that get a nonce but no sign-in gate. */
const OPEN_PAGES = /^\/auth(?:\/|$)/;

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = contentSecurityPolicy({ isDev: process.env.NODE_ENV === "development", nonce });

  // Next reads the nonce from the request's policy and stamps it on its own scripts.
  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set("Content-Security-Policy", csp);

  const response = await gate(request, headers);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/** Lets the request through, or redirects it to sign-in. Fails closed when auth is not configured. */
async function gate(request: NextRequest, headers: Headers): Promise<NextResponse> {
  if (OPEN_PAGES.test(request.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers } });
  }

  const auth = getNeonAuth();
  if (!auth) return NextResponse.redirect(new URL(SIGN_IN, request.url));

  // Neon Auth forwards the headers of the request it is given, so the nonce reaches the page.
  // The body stays on the original request, which is what the route receives.
  return auth.middleware({ loginUrl: SIGN_IN })(
    new NextRequest(request.url, { method: request.method, headers }),
  );
}

export const config = {
  // Skipped: the auth handler, webhooks (signature-checked), cron (CRON_SECRET) and static files.
  // They serve JSON or files, which a CSP does not govern.
  matcher: [
    "/((?!api/auth(?:/|$)|api/webhooks(?:/|$)|api/cron(?:/|$)|_next/static|_next/image|favicon\\.ico$).*)",
  ],
};
