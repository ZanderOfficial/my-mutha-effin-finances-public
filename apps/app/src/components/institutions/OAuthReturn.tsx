"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import {
  clearLinkSession,
  completionRequest,
  resolveOAuthReturn,
  type LinkSession,
} from "@/lib/plaid-oauth";

const BACK = "/institutions";

const noSubscribe = () => () => {};
// null on the server and during hydration, the real address afterwards.
const currentHref = () => window.location.href;
const serverHref = () => null;

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-4">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h2>
      <p role="status" className="max-w-xl text-[17px] text-muted">
        {children}
      </p>
      <Link
        href={BACK}
        className="mt-4 inline-flex min-h-11 items-center border-2 border-income px-6 text-base font-bold glow-income-sm"
      >
        Back to My Institutions
      </Link>
    </section>
  );
}

type Outcome = "working" | "closed" | "failed";

/** Reopens Link with the stored token and the redirect the bank sent back. */
function Resume({
  session,
  receivedRedirectUri,
}: {
  session: LinkSession;
  receivedRedirectUri: string;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>("working");
  const opened = useRef(false);

  const { open, ready } = usePlaidLink({
    token: session.token,
    receivedRedirectUri,
    onSuccess: async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      // The link token is spent either way; never leave it behind.
      clearLinkSession(window.localStorage);
      const req = completionRequest(
        session,
        publicToken,
        metadata.institution
          ? {
              name: metadata.institution.name,
              institution_id: metadata.institution.institution_id,
            }
          : null,
      );
      if (!req) return setOutcome("failed");
      try {
        const res = await fetch(req.url, {
          method: "POST",
          cache: "no-store",
          headers: req.body ? { "Content-Type": "application/json" } : undefined,
          body: req.body ? JSON.stringify(req.body) : undefined,
        });
        if (!res.ok) return setOutcome("failed");
      } catch {
        return setOutcome("failed");
      }
      router.replace(BACK);
      router.refresh();
    },
    onExit: (err) => {
      clearLinkSession(window.localStorage);
      setOutcome(err ? "failed" : "closed");
    },
  });

  useEffect(() => {
    if (ready && !opened.current) {
      opened.current = true;
      open();
    }
  }, [ready, open]);

  if (outcome === "failed") {
    return (
      <Message title="Could not finish linking">
        <span role="alert">! </span>
        That bank sign-in could not be completed. It may have expired or already been used.
        Start again from My Institutions; nothing was linked.
      </Message>
    );
  }
  if (outcome === "closed") {
    return <Message title="Linking cancelled">Nothing was linked.</Message>;
  }
  return (
    <p role="status" className="text-[17px] text-muted">
      Finishing your bank sign-in…
    </p>
  );
}

function Resolver({ href }: { href: string }) {
  // Read once, when the page opens. Resolving does not consume the stored
  // token; Link clears it when it finishes.
  const [resume] = useState(() => resolveOAuthReturn(window.localStorage, href, Date.now()));

  if (resume.status === "resume") {
    return <Resume session={resume.session} receivedRedirectUri={resume.receivedRedirectUri} />;
  }
  if (resume.status === "missing") {
    return (
      <Message title="This bank sign-in expired">
        We no longer have the Plaid session for this return, so it cannot be finished here. It
        may have timed out, been used already, or started in a different browser. Start again
        from My Institutions; nothing was linked.
      </Message>
    );
  }
  return (
    <Message title="Nothing to finish">
      This page only finishes a bank sign-in that Plaid sends you back to. Start a link from
      My Institutions.
    </Message>
  );
}

export function OAuthReturn() {
  const href = useSyncExternalStore(noSubscribe, currentHref, serverHref);
  if (href === null) return null;
  return <Resolver href={href} />;
}
