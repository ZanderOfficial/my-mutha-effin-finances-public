import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * The only module that builds the Neon Auth server instance. It is created
 * lazily and returns null when the environment is incomplete, so a missing
 * configuration means "nobody is signed in" rather than a crash or, worse, an
 * open door. The cookie secret must be at least 32 characters (the SDK throws
 * otherwise).
 */
type NeonAuth = ReturnType<typeof createNeonAuth>;

let cached: NeonAuth | null | undefined;

export function isAuthConfigured(): boolean {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  return Boolean(process.env.NEON_AUTH_BASE_URL) && Boolean(secret) && (secret as string).length >= 32;
}

export function getNeonAuth(): NeonAuth | null {
  if (cached !== undefined) return cached;
  if (!isAuthConfigured()) {
    // Do not cache a negative: env may be loaded after first call in dev.
    return null;
  }
  cached = createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL as string,
    cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET as string },
  });
  return cached;
}
