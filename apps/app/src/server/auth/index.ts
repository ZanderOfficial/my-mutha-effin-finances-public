import { redirect } from "next/navigation";
import { isOwner, type SessionUser } from "./is-owner";
import { getNeonAuth } from "./neon";

export { isOwner } from "./is-owner";

export const SIGN_IN_PATH = "/auth/sign-in";

/**
 * The owner id (the Neon Auth user id) for a session user, or null when the
 * user is not the owner or has no usable id. Pure, so it is unit-tested.
 */
export function ownerIdFor(
  user: SessionUser | null | undefined,
  ownerEmail?: string,
): string | null {
  const ok = ownerEmail === undefined ? isOwner(user) : isOwner(user, ownerEmail);
  if (!ok || !user) return null;
  return typeof user.id === "string" && user.id.trim() !== "" ? user.id : null;
}

/**
 * Never throws. Returns the signed-in owner's id, or null when auth is not
 * configured, nobody is signed in, the session lookup fails, or the user is
 * not the owner. Use it where "no data" is the right answer (screens, API
 * routes that return 401).
 */
export async function getOwnerId(): Promise<string | null> {
  const auth = getNeonAuth();
  if (!auth) return null;
  try {
    const { data: session } = await auth.getSession();
    return ownerIdFor(session?.user as SessionUser | undefined);
  } catch {
    return null;
  }
}

/**
 * Returns the owner id or redirects to sign-in. Every server data access calls
 * this (or getOwnerId); the proxy is a convenience, not the guard.
 */
export async function requireOwner(): Promise<string> {
  const ownerId = await getOwnerId();
  if (!ownerId) redirect(SIGN_IN_PATH);
  return ownerId;
}
