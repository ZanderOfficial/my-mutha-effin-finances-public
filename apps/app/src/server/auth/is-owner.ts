/** The slice of a session user that ownership depends on. */
export type SessionUser = {
  id?: unknown;
  email?: unknown;
  emailVerified?: unknown;
};

/**
 * Pure ownership check. Fails closed:
 *  - false when OWNER_EMAIL is unset, empty or blank;
 *  - false when the user or its email is missing or not a string;
 *  - false when the session exposes an emailVerified flag and it is not true
 *    (an absent flag is allowed: Neon Auth only exposes it when verification
 *    is on, and the email match still has to hold);
 *  - otherwise a case-insensitive, whitespace-trimmed email match.
 */
export function isOwner(
  user: SessionUser | null | undefined,
  ownerEmail: string | undefined = process.env.OWNER_EMAIL,
): boolean {
  if (!user || typeof user !== "object") return false;
  const expected = typeof ownerEmail === "string" ? ownerEmail.trim().toLowerCase() : "";
  if (expected === "") return false;
  if (typeof user.email !== "string") return false;
  if ("emailVerified" in user && user.emailVerified !== undefined && user.emailVerified !== null) {
    if (user.emailVerified !== true) return false;
  }
  return user.email.trim().toLowerCase() === expected;
}
