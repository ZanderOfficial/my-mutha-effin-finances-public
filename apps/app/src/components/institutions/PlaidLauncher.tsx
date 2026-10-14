"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { clearLinkSession, saveLinkSession } from "@/lib/plaid-oauth";

type Props = {
  label: string;
  /** Same-origin route that returns { link_token }. */
  tokenUrl: string;
  /**
   * What this Link session is for. It is remembered, with the link token, for
   * the length of the session so the OAuth return page can reopen Link after a
   * bank redirects the browser away and back (see src/lib/plaid-oauth.ts).
   */
  session: { kind: "new" } | { kind: "update"; itemId: string };
  /** Called with Link's one-time public token; throw to show an error. */
  onLinked: (
    publicToken: string,
    metadata: PlaidLinkOnSuccessMetadata,
  ) => Promise<void>;
  className?: string;
};

/** Mounted only once a link token exists, because hooks cannot be conditional. */
function Opener({
  token,
  onSuccess,
  onClose,
}: {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void;
  onClose: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken, metadata) => {
      if (publicToken) onSuccess(publicToken, metadata);
      else onClose();
    },
    onExit: onClose,
  });
  const opened = useRef(false);
  useEffect(() => {
    if (ready && !opened.current) {
      opened.current = true;
      open();
    }
  }, [ready, open]);
  return null;
}

/**
 * Opens Plaid Link. The page never sees credentials: the user signs in inside
 * Plaid's own screen. The only things this component handles are the
 * short-lived link token (from our server) and the one-time public token
 * (handed back to our server), neither of which is logged or stored.
 */
export function PlaidLauncher({ label, tokenUrl, session, onLinked, className }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(tokenUrl, { method: "POST", cache: "no-store" });
      const body = (await res.json().catch(() => null)) as {
        link_token?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.link_token) {
        throw new Error(body?.error ?? "Could not start Plaid Link.");
      }
      // Kept only so an OAuth bank's redirect can resume this same Link session.
      saveLinkSession(
        window.localStorage,
        session.kind === "update"
          ? { kind: "update", token: body.link_token, itemId: session.itemId }
          : { kind: "new", token: body.link_token },
        Date.now(),
      );
      setToken(body.link_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Plaid Link.");
      setBusy(false);
    }
  }, [tokenUrl, session]);

  const finish = useCallback(() => {
    clearLinkSession(window.localStorage);
    setToken(null);
    setBusy(false);
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      try {
        await onLinked(publicToken, metadata);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        finish();
      }
    },
    [onLinked, finish],
  );

  return (
    <span className="inline-flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={className}
      >
        {busy ? "Opening…" : label}
      </button>
      {error && (
        <span role="alert" className="text-sm text-spending">
          ! {error}
        </span>
      )}
      {token && <Opener key={token} token={token} onSuccess={onSuccess} onClose={finish} />}
    </span>
  );
}
