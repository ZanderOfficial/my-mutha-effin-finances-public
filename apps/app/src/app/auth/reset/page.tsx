import { isAuthConfigured } from "@/server/auth/neon";
import { ResetForm } from "./ResetForm";

// Reads environment at request time; never prerender a stale answer.
export const dynamic = "force-dynamic";

export default function ResetPage() {
  const configured = isAuthConfigured();

  return (
    <main id="main" className="flex flex-1 items-start justify-center px-6 py-16 sm:px-10">
      <section aria-labelledby="reset-title" className="w-full max-w-md border-t border-rule pt-4">
        <h1
          id="reset-title"
          className="mb-2 font-display text-5xl font-black uppercase leading-none tracking-wide"
        >
          Reset password
        </h1>
        <p className="mb-8 text-[17px] text-muted">
          We email a code to the owner address. You pick the password. We never see it.
        </p>
        {configured ? (
          <ResetForm />
        ) : (
          <p role="alert" className="text-[17px]">
            <span className="glow-spending-sm font-bold">! </span>
            Sign-in is not configured, so there is nothing to reset yet.
          </p>
        )}
      </section>
    </main>
  );
}
