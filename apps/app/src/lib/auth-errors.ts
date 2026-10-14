/**
 * Turns whatever the auth client returned or threw into one honest sentence.
 * Neon's client can either return `{ error }` or throw, depending on its
 * fetch options, so both shapes are read. Messages never echo the input.
 */
type Maybe = { status?: unknown; code?: unknown; error?: unknown } | null | undefined;

function statusOf(err: unknown): number | null {
  const e = err as Maybe;
  if (typeof e?.status === "number") return e.status;
  const inner = e?.error as Maybe;
  if (typeof inner?.status === "number") return inner.status;
  return null;
}

export type AuthAction = "sign-in" | "send-code" | "reset";

export function authErrorMessage(err: unknown, action: AuthAction): string {
  const status = statusOf(err);
  if (status === null) return "Could not reach sign-in. Check your connection and try again.";
  if (action === "sign-in" && status === 401) {
    return "That email and password do not match. If you never set a password, reset it below.";
  }
  if (action === "reset" && (status === 400 || status === 401)) {
    return "That code did not work or has expired. Send a new one.";
  }
  if (status === 403) return "This account cannot sign in this way yet. Check the Auth settings in Neon.";
  if (status === 429) return "Too many tries. Wait a minute and try again.";
  if (status === 400) return "Sign-in with email and password is not accepted right now. Check the Auth settings in Neon.";
  return "Something went wrong on the sign-in service. Try again.";
}
