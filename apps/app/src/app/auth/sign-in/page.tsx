import { isAuthConfigured } from "@/server/auth/neon";
import { SignInForm } from "./SignInForm";

// Reads environment at request time; never prerender a stale answer.
export const dynamic = "force-dynamic";

export default function SignInPage() {
  const configured = isAuthConfigured();

  return (
    <main id="main" className="flex flex-1 items-start justify-center px-6 py-16 sm:px-10">
      <section aria-labelledby="sign-in-title" className="w-full max-w-md border-t border-rule pt-4">
        <h1
          id="sign-in-title"
          className="mb-2 font-display text-5xl font-black uppercase leading-none tracking-wide"
        >
          Sign in
        </h1>
        <p className="mb-8 text-[17px] text-muted">
          One owner, one door. Everyone else gets nothing.
        </p>
        {configured ? (
          <SignInForm />
        ) : (
          <p role="alert" className="text-[17px]">
            <span className="glow-spending-sm font-bold">! </span>
            Sign-in is not configured. Locked out. Fix it before the numbers lie
            (see setup/05-secrets-and-security.md).
          </p>
        )}
      </section>
    </main>
  );
}
