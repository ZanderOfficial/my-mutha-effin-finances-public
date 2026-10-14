"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";

const FIELD =
  "block min-h-11 w-full border border-rule bg-panel px-3 text-base text-foreground focus:border-foreground";
const LABEL = "block text-[13px] font-semibold uppercase tracking-[0.14em] text-muted";
const BUTTON =
  "inline-flex min-h-11 items-center border-2 border-income px-6 text-base font-bold glow-income-sm disabled:opacity-60";

const MIN_PASSWORD = 12;

/**
 * Two steps, both through Neon Auth's email-code flow on our same-origin
 * /api/auth route: send a one-time code to the address, then set a new
 * password with that code. It also works for an account that never had a
 * password. The password goes straight to Neon; nothing here stores or logs it.
 */
export function ResetForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!address) return setError("Enter the email address.");
    setPending(true);
    setError(null);
    try {
      const { error: sendError } = await authClient.emailOtp.requestPasswordReset({ email: address });
      if (sendError) return setError(authErrorMessage(sendError, "send-code"));
      setEmail(address);
      setStep("code");
      setNotice("If that address has an account, a code is on its way. Check your inbox and spam.");
    } catch (err) {
      setError(authErrorMessage(err, "send-code"));
    } finally {
      setPending(false);
    }
  }

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const otp = String(form.get("otp") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (!otp) return setError("Enter the code from the email.");
    if (password.length < MIN_PASSWORD) {
      return setError(`Use at least ${MIN_PASSWORD} characters.`);
    }
    if (password !== confirm) return setError("The two passwords do not match.");
    setPending(true);
    setError(null);
    try {
      const { error: resetError } = await authClient.emailOtp.resetPassword({ email, otp, password });
      if (resetError) return setError(authErrorMessage(resetError, "reset"));
      const { error: signInError } = await authClient.signIn.email({ email, password });
      if (signInError) {
        setNotice("Password set. Sign in with it now.");
        router.replace("/auth/sign-in");
        return;
      }
      router.replace("/overview");
      router.refresh();
    } catch (err) {
      setError(authErrorMessage(err, "reset"));
    } finally {
      setPending(false);
    }
  }

  const message = (
    <>
      {error && (
        <p role="alert" className="text-[17px]">
          <span className="glow-spending-sm font-bold">! </span>
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="text-[17px] text-muted">
          {notice}
        </p>
      )}
    </>
  );

  if (step === "email") {
    return (
      <form onSubmit={sendCode} className="space-y-5" noValidate>
        <label className={LABEL}>
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className={`${FIELD} mt-2 font-normal normal-case tracking-normal`}
          />
        </label>
        {message}
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Sending" : "Email me a code"}
        </button>
        <p className="text-[15px] text-muted">
          <Link href="/auth/sign-in" className="text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={reset} className="space-y-5" noValidate>
      <p className="text-[15px] text-muted">
        Code sent to <span className="text-foreground">{email}</span>.
      </p>
      <label className={LABEL}>
        Code from the email
        <input
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          className={`${FIELD} mt-2 font-normal normal-case tracking-normal`}
        />
      </label>
      <label className={LABEL}>
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          className={`${FIELD} mt-2 font-normal normal-case tracking-normal`}
        />
      </label>
      <label className={LABEL}>
        New password again
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          className={`${FIELD} mt-2 font-normal normal-case tracking-normal`}
        />
      </label>
      {message}
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Saving" : "Set password and sign in"}
      </button>
      <p className="text-[15px] text-muted">
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setError(null);
            setNotice(null);
          }}
          className="min-h-11 text-foreground underline underline-offset-4"
        >
          Send a new code
        </button>
      </p>
    </form>
  );
}
