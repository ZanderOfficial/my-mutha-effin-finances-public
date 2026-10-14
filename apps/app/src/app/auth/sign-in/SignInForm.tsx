"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

const FIELD =
  "block min-h-11 w-full border border-rule bg-panel px-3 text-base text-foreground focus:border-foreground";

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { error: signInError } = await authClient.signIn.email({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      if (signInError) {
        setError(authErrorMessage(signInError, "sign-in"));
        return;
      }
      router.replace("/overview");
      router.refresh();
    } catch (err) {
      setError(authErrorMessage(err, "sign-in"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <label className="block text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className={`${FIELD} mt-2 font-normal normal-case tracking-normal`}
        />
      </label>
      <label className="block text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`${FIELD} mt-2 font-normal normal-case tracking-normal`}
        />
      </label>
      {error && (
        <p role="alert" className="text-[17px]">
          <span className="glow-spending-sm font-bold">! </span>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center border-2 border-income px-6 text-base font-bold glow-income-sm disabled:opacity-60"
      >
        {pending ? "Signing in" : "Sign in"}
      </button>
      <p className="text-[15px] text-muted">
        Forgot it, or never set one?{" "}
        <Link href="/auth/reset" className="text-foreground underline underline-offset-4">
          Reset your password
        </Link>
      </p>
    </form>
  );
}
